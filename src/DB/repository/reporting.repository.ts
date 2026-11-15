import type { PipelineStage } from 'mongoose';
import { OrderModel } from '../models/order/order.model';
import { safeMoney } from '../../Utils/money';
import { pagination } from '../../Utils/pagination';

export interface ReportingPeriod { from: Date; to: Date }
export function paidOrderMatch(period?: ReportingPeriod) {
  // Paid is written only after provider amount/currency verification. Refunds are
  // not persisted by this backend; do not infer them from fulfillment status.
  return { schemaVersion: 2, 'payment.status': 'paid', status: { $ne: 'cancelled' },
    'payment.paidAt': period ? { $gte: period.from, $lte: period.to } : { $type: 'date' } };
}
export function paidProductStages(period?: ReportingPeriod, separateCurrencies = false): PipelineStage[] {
  const currency = separateCurrencies ? { currency: '$currency', currencyExponent: '$currencyExponent' } : {};
  return [
    { $match: paidOrderMatch(period) },
    { $unwind: '$items' },
    // Collapse repeated product lines within an order before counting orders.
    { $group: { _id: { order: '$_id', product: '$items.product', ...currency },
      quantity: { $sum: '$items.quantity' },
      lineSalesMinor: { $sum: { $toDecimal: '$items.lineTotalMinor' } },
      name: { $first: '$items.name' }, sku: { $first: '$items.sku' },
    } },
    { $group: { _id: separateCurrencies
      ? { product: '$_id.product', currency: '$_id.currency', currencyExponent: '$_id.currencyExponent' }
      : '$_id.product',
      unitsSold: { $sum: '$quantity' }, orderCount: { $sum: 1 },
      lineSalesMinor: { $sum: '$lineSalesMinor' }, name: { $first: '$name' }, sku: { $first: '$sku' },
    } },
  ];
}
type SalesRow = { currency: string; currencyExponent: number; period?: string; paidOrders: number; paidSalesMinor: { toString(): string } };
export const reportingRepository = {
  async sales(period: ReportingPeriod, groupBy?: 'day' | 'month') {
    const rows = await OrderModel.aggregate<SalesRow>([
      { $match: paidOrderMatch(period) },
      // No item unwind: each paid order contributes its total exactly once.
      { $group: { _id: { currency: '$currency', currencyExponent: '$currencyExponent',
        ...(groupBy ? { period: { $dateToString: { date: '$payment.paidAt', format: groupBy === 'day' ? '%Y-%m-%d' : '%Y-%m', timezone: 'UTC' } } } : {}),
      }, paidOrders: { $sum: 1 }, paidSalesMinor: { $sum: { $toDecimal: '$grandTotalMinor' } } } },
      { $project: { _id: 0, currency: '$_id.currency', currencyExponent: '$_id.currencyExponent',
        ...(groupBy ? { period: '$_id.period' } : {}), paidOrders: 1, paidSalesMinor: 1 } },
      { $sort: { period: 1, currency: 1, currencyExponent: 1 } },
    ]).option({ maxTimeMS: 15000 }).exec();
    return rows.map((row) => {
      const paidSalesMinor = safeMoney(Number(row.paidSalesMinor.toString()));
      return { ...row, paidSalesMinor, averageOrderValueMinor: Math.round(paidSalesMinor / row.paidOrders) };
    });
  },
  async topProducts(period: ReportingPeriod, page: number, limit: number, currency?: string) {
    const pipeline = paidProductStages(period, true);
    if (currency) pipeline.splice(1, 0, { $match: { currency } });
    type Row = { productId: unknown; currency: string; currencyExponent: number; unitsSold: number;
      orderCount: number; name: string; sku: string; lineSalesMinor: { toString(): string } };
    const [result] = await OrderModel.aggregate<{ products: Row[]; total: { count: number }[] }>([
      ...pipeline,
      { $sort: { unitsSold: -1, '_id.product': 1, '_id.currency': 1, '_id.currencyExponent': 1 } },
      { $facet: { products: [
        { $skip: (page - 1) * limit }, { $limit: limit },
        { $project: { _id: 0, productId: '$_id.product', currency: '$_id.currency', currencyExponent: '$_id.currencyExponent',
          unitsSold: 1, orderCount: 1, name: 1, sku: 1, lineSalesMinor: 1 } },
      ], total: [{ $count: 'count' }] } },
    ]).option({ maxTimeMS: 15000 }).exec();
    return { products: (result?.products ?? []).map((row) => ({ ...row,
      lineSalesMinor: safeMoney(Number(row.lineSalesMinor.toString())),
    })), pagination: pagination(page, limit, result?.total[0]?.count ?? 0) };
  },
};
