import mongoose, { Types, type Model, type ClientSession, type QueryFilter } from 'mongoose';
import { createHash } from 'node:crypto';
import { CartModel } from '../models/cart/cart.model';
import { ProductModel } from '../models/product/product.model';
import { UserModel } from '../models/user/user.model';
import { OrderModel, type OrderStatus } from '../models/order/order.model';
import type { CartDocument, ICart } from '../models/cart/cart.interface';
import type { IProduct } from '../models/product/product.interface';
import type { CheckoutDTO } from '../../Modules/order/order.dto';
import { cartLimits } from '../../Modules/cart/cart.config';
import {
  ApplicationException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '../../Utils/response/error.response';
import { safeMoney, storeMoney, toMinor } from '../../Utils/money';

const carts = CartModel as Model<ICart>;
const products = ProductModel as Model<IProduct>;
type Order = mongoose.InferSchemaType<typeof OrderModel.schema> & {
  _id: Types.ObjectId;
};
export type OrderListInput = {
  page: number;
  limit: number;
  status?: OrderStatus | undefined;
  user?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
};

export function checkoutFingerprint(input: CheckoutDTO) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: input.version,
        addressId: input.addressId.toLowerCase(),
        items: input.items
          .map((item) => ({
            productId: item.productId.toLowerCase(),
            unitPriceMinor: item.unitPriceMinor,
          }))
          .sort((a, b) => a.productId.localeCompare(b.productId)),
      }),
    )
    .digest('hex');
}

// Deliberately whitelist output. Legacy records retain their original major-unit values.
export function orderResponse(order: Order, detail = true) {
  const common = {
    _id: order._id,
    user: order.user,
    status: order.status,
    paymentStatus: order.payment?.status ?? 'unpaid',
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
  if (order.schemaVersion !== 2)
    return {
      ...common,
      schemaVersion: 1,
      legacy: true,
      currency: null,
      total: order.total,
      shippingAddress: null,
      items: order.items.map((item) => ({
        product: item.product,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        name: null,
        sku: null,
      })),
    };
  return {
    ...common,
    schemaVersion: 2,
    currency: order.currency,
    currencyExponent: order.currencyExponent,
    items: order.items.map((item) => ({
      product: item.product,
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      lineTotalMinor: item.lineTotalMinor,
    })),
    subtotalMinor: order.subtotalMinor,
    shippingMinor: order.shippingMinor,
    discountMinor: order.discountMinor,
    taxMinor: order.taxMinor,
    grandTotalMinor: order.grandTotalMinor,
    ...(detail
      ? {
          shippingAddress: order.shippingAddress,
          statusHistory: order.statusHistory.map((entry) => ({
            status: entry.status,
            actor: entry.actor,
            at: entry.at,
            reason: entry.reason,
          })),
          cancelledAt: order.cancelledAt,
          cancelledBy: order.cancelledBy,
          cancellationReason: order.cancellationReason,
          stockRestoredAt: order.stockRestoredAt,
        }
      : {}),
  };
}

class OrderRepository {
  private async replay(
    user: Types.ObjectId,
    key: string,
    fingerprint: string,
    session?: ClientSession,
  ) {
    const order = await OrderModel.findOne({ user, idempotencyKey: key })
      .session(session ?? null)
      .exec();
    if (!order) return null;
    if (order.requestFingerprint !== fingerprint)
      throw new ConflictException('Idempotency key was used with a different request');
    return { order: orderResponse(order), replayed: true };
  }

  async checkout(user: Types.ObjectId, input: CheckoutDTO, key: string) {
    const fingerprint = checkoutFingerprint(input);
    const existing = await this.replay(user, key, fingerprint);
    if (existing) return existing;
    const currency = storeMoney();
    try {
      return await mongoose.connection.transaction(async (session) => {
        const replay = await this.replay(user, key, fingerprint, session);
        if (replay) return replay;
        const cart = (await carts.findOne({ user }).session(session).exec()) as CartDocument | null;
        if (!cart || cart.items.length === 0) throw new BadRequestException('Cart is empty');
        if (cart.__v !== input.version)
          throw new ConflictException('Cart changed; refresh before checkout');
        const limits = cartLimits();
        if (
          cart.items.length > limits.maxItems ||
          cart.items.some(
            (item) =>
              !Number.isSafeInteger(item.quantity) ||
              item.quantity < 1 ||
              item.quantity > limits.maxQuantity,
          )
        ) {
          throw new BadRequestException('Cart exceeds configured limits');
        }
        const prices = new Map(
          input.items.map((item) => [item.productId.toLowerCase(), item.unitPriceMinor]),
        );
        if (prices.size !== input.items.length || prices.size !== cart.items.length)
          throw new ConflictException('Checkout items do not match cart');
        const owner = await UserModel.findOne({
          _id: user,
          'address._id': new Types.ObjectId(input.addressId),
        })
          .select('address')
          .session(session)
          .exec();
        const address = owner?.address?.find((value) => value._id?.toString() === input.addressId);
        if (!address) throw new NotFoundException('Address not found');
        const shippingAddress = {
          fullName: address.fullName,
          phone: address.phone,
          country: address.country,
          city: address.city,
          street: address.street,
          ...(address.building !== undefined ? { building: address.building } : {}),
          ...(address.apartment !== undefined ? { apartment: address.apartment } : {}),
        };
        const items = [];
        let subtotalMinor = 0;
        for (const item of cart.items) {
          const product = await products
            .findOne({ _id: item.product, isActive: true })
            .session(session)
            .exec();
          if (!product) throw new ConflictException('Product is unavailable; refresh cart');
          const unitPriceMinor = toMinor(product.price, currency.currencyExponent);
          if (prices.get(item.product.toString()) !== unitPriceMinor)
            throw new ConflictException('Product price changed; refresh cart');
          const changed = await products
            .findOneAndUpdate(
              {
                _id: item.product,
                isActive: true,
                price: product.price,
                stock: { $gte: item.quantity },
              },
              { $inc: { stock: -item.quantity } },
              { session, returnDocument: 'after' },
            )
            .exec();
          if (!changed)
            throw new ConflictException(
              'Product price, availability or stock changed; refresh cart',
            );
          const lineTotalMinor = safeMoney(unitPriceMinor * item.quantity);
          subtotalMinor = safeMoney(subtotalMinor + lineTotalMinor);
          items.push({
            product: item.product,
            name: changed.name,
            sku: changed.sku,
            quantity: item.quantity,
            unitPriceMinor,
            lineTotalMinor,
          });
        }
        const [order] = await OrderModel.create(
          [
            {
              user,
              schemaVersion: 2,
              ...currency,
              shippingAddress,
              items,
              subtotalMinor,
              shippingMinor: 0,
              discountMinor: 0,
              taxMinor: 0,
              grandTotalMinor: subtotalMinor,
              status: 'placed',
              statusHistory: [{ status: 'placed', actor: user, at: new Date() }],
              idempotencyKey: key,
              requestFingerprint: fingerprint,
            },
          ],
          { session },
        );
        const cleared = await carts
          .updateOne(
            { _id: cart._id, __v: input.version },
            { $set: { items: [] }, $inc: { __v: 1 } },
            { session },
          )
          .exec();
        if (cleared.modifiedCount !== 1)
          throw new ConflictException('Cart changed; refresh before checkout');
        return { order: orderResponse(order!), replayed: false };
      });
    } catch (error) {
      // A concurrent winner may have cleared the cart before this attempt took its snapshot.
      const replay = await this.replay(user, key, fingerprint);
      if (replay) return replay;
      const failure = error as {
        code?: number;
        hasErrorLabel?: (label: string) => boolean;
      };
      if (failure.hasErrorLabel?.('UnknownTransactionCommitResult')) {
        throw new ApplicationException(
          'Checkout outcome is uncertain; retry with the same Idempotency-Key',
          503,
        );
      }
      if (failure.code === 11000 || failure.hasErrorLabel?.('TransientTransactionError')) {
        throw new ConflictException('Checkout conflicted; retry with the same Idempotency-Key');
      }
      throw error;
    }
  }

  async list(input: OrderListInput, owner?: Types.ObjectId) {
    const filter: QueryFilter<Order> = {};
    if (owner) filter.user = owner;
    else if (input.user) filter.user = new Types.ObjectId(input.user);
    if (input.status) filter.status = input.status;
    if (input.from || input.to)
      filter.createdAt = {
        ...(input.from ? { $gte: new Date(input.from) } : {}),
        ...(input.to ? { $lte: new Date(input.to) } : {}),
      };
    const [orders, total] = await Promise.all([
      OrderModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((input.page - 1) * input.limit)
        .limit(input.limit)
        .exec(),
      OrderModel.countDocuments(filter).exec(),
    ]);
    return {
      orders: orders.map((order) => orderResponse(order, false)),
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  }

  async details(id: string, owner?: Types.ObjectId) {
    const order = await OrderModel.findOne({
      _id: new Types.ObjectId(id),
      ...(owner ? { user: owner } : {}),
    }).exec();
    if (!order) throw new NotFoundException('Order not found');
    return orderResponse(order);
  }

  async transition(
    id: string,
    actor: Types.ObjectId,
    admin: boolean,
    target: OrderStatus,
    expected?: OrderStatus,
    reason?: string,
  ) {
    return mongoose.connection.transaction(async (session) => {
      const filter = {
        _id: new Types.ObjectId(id),
        ...(!admin ? { user: actor } : {}),
      };
      const order = await OrderModel.findOne(filter).session(session).exec();
      if (!order) throw new NotFoundException('Order not found');
      if (order.schemaVersion !== 2)
        throw new ConflictException(
          'Legacy orders require manual review before fulfillment or cancellation',
        );
      if (target === 'cancelled' && order.status === 'cancelled' && order.stockRestoredAt)
        return orderResponse(order);
      if (expected !== undefined && order.status !== expected)
        throw new ConflictException('Order status changed');
      if (target === 'cancelled' && order.payment && order.payment.status !== 'expired')
        throw new ConflictException('Pending or paid payments require reconciliation before cancellation');
      if (target !== 'cancelled' && order.payment && order.payment.status !== 'paid')
        throw new ConflictException('Payment must be confirmed before fulfillment');
      const allowed: Record<OrderStatus, readonly OrderStatus[]> = {
        placed: admin ? ['processing', 'cancelled'] : ['cancelled'],
        processing: admin ? ['shipped', 'cancelled'] : [],
        shipped: admin ? ['delivered'] : [],
        delivered: [],
        cancelled: [],
      };
      if (!allowed[order.status].includes(target))
        throw new ConflictException('Invalid order status transition');
      const now = new Date();
      const updated = await OrderModel.findOneAndUpdate(
        {
          ...filter,
          status: order.status,
          stockRestoredAt: { $exists: false },
        },
        {
          $set: {
            status: target,
            ...(target === 'cancelled'
              ? {
                  cancelledAt: now,
                  cancelledBy: actor,
                  ...(reason ? { cancellationReason: reason } : {}),
                  stockRestoredAt: now,
                }
              : {}),
          },
          $push: {
            statusHistory: {
              status: target,
              actor,
              at: now,
              ...(reason ? { reason } : {}),
            },
          },
        },
        { session, returnDocument: 'after', runValidators: true },
      ).exec();
      if (!updated) throw new ConflictException('Order status changed');
      if (target === 'cancelled') {
        for (const item of order.items) {
          if (!Number.isSafeInteger(item.quantity) || item.quantity < 1)
            throw new ConflictException('Invalid historical quantity; manual repair required');
          const restored = await products
            .updateOne(
              {
                _id: item.product,
                stock: {
                  $gte: 0,
                  $lte: Number.MAX_SAFE_INTEGER - item.quantity,
                },
                $expr: { $eq: [{ $mod: ['$stock', 1] }, 0] },
              },
              { $inc: { stock: item.quantity } },
              { session },
            )
            .exec();
          if (restored.matchedCount !== 1)
            throw new ConflictException('Inventory cannot be restored; manual repair required');
        }
      }
      return orderResponse(updated);
    });
  }
}
export const orderRepository = new OrderRepository();
