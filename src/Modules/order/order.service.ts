import { Types } from 'mongoose';
import { orderRepository } from '../../DB/repository/order.repository';
import {
  checkoutSchema,
  idempotencyKeySchema,
  orderIdSchema,
  orderListSchema,
  adminOrderListSchema,
  cancelSchema,
  transitionSchema,
} from './order.validation';
import { BadRequestException } from '../../Utils/response/error.response';
import { z } from 'zod';
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new BadRequestException('Invalid order request', {
      cause: result.error.issues,
    });
  return result.data;
}
class OrderService {
  async checkout(user: Types.ObjectId, input: unknown, key: unknown) {
    return orderRepository.checkout(
      user,
      parse(checkoutSchema, input),
      parse(idempotencyKeySchema, key),
    );
  }
  async list(user: Types.ObjectId, input: unknown) {
    return orderRepository.list(parse(orderListSchema, input), user);
  }
  async adminList(input: unknown) {
    return orderRepository.list(parse(adminOrderListSchema, input));
  }
  async details(id: unknown, user?: Types.ObjectId) {
    return orderRepository.details(parse(orderIdSchema, { orderId: id }).orderId, user);
  }
  async cancel(user: Types.ObjectId, id: unknown, input: unknown) {
    const body = parse(cancelSchema, input);
    return orderRepository.transition(
      parse(orderIdSchema, { orderId: id }).orderId,
      user,
      false,
      'cancelled',
      undefined,
      body.reason,
    );
  }
  async transition(actor: Types.ObjectId, id: unknown, input: unknown) {
    const body = parse(transitionSchema, input);
    return orderRepository.transition(
      parse(orderIdSchema, { orderId: id }).orderId,
      actor,
      true,
      body.status,
      body.expectedStatus,
      body.reason,
    );
  }
}
export const orderService = new OrderService();
