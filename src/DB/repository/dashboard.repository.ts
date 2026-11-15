import { ProductModel } from '../models/product/product.model';
import type { Model } from 'mongoose';
import type { IProduct } from '../models/product/product.interface';
import { CategoryModel } from '../models/category/category.model';
import { UserModel } from '../models/user/user.model';
import { RoleEnum } from '../models/user/user.interface';
import { OrderModel, orderStatuses } from '../models/order/order.model';
import { orderRepository } from './order.repository';
import type { ReportingPeriod } from './reporting.repository';

export const dashboardRepository = {
  async overview(period: ReportingPeriod, threshold: number) {
    const [productCounts, customers, categories, statuses, recent, latestProducts, lowStockProducts] = await Promise.all([
      ProductModel.aggregate([{ $group: { _id: null,
        total: { $sum: 1 }, active: { $sum: { $cond: ['$isActive', 1, 0] } },
        lowStock: { $sum: { $cond: [{ $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', threshold] }] }, 1, 0] } },
        outOfStock: { $sum: { $cond: [{ $eq: ['$stock', 0] }, 1, 0] } },
      } }, { $project: { _id: 0 } }]).option({ maxTimeMS: 15000 }).exec(),
      UserModel.countDocuments({ role: RoleEnum.USER, deletedAt: null }).exec(),
      CategoryModel.countDocuments({}).exec(),
      OrderModel.aggregate<{ _id: string; count: number }>([
        { $match: { createdAt: { $gte: period.from, $lte: period.to } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]).option({ maxTimeMS: 15000 }).exec(),
      orderRepository.list({ page: 1, limit: 5, from: period.from.toISOString(), to: period.to.toISOString() }),
      (ProductModel as Model<IProduct>).find({}).select('name slug price stock isActive images createdAt')
        .sort({ createdAt: -1, _id: -1 }).limit(5).lean().exec(),
      (ProductModel as Model<IProduct>).find({ stock: { $gt: 0, $lte: threshold } }).select('name sku stock isActive')
        .sort({ stock: 1, _id: 1 }).limit(5).lean().exec(),
    ]);
    const ordersByStatus = Object.fromEntries(orderStatuses.map((status) => [status, 0]));
    for (const row of statuses) ordersByStatus[row._id] = row.count;
    return { totals: { customers, categories,
      products: productCounts[0] ?? { total: 0, active: 0, lowStock: 0, outOfStock: 0 } },
      periodOrders: { total: statuses.reduce((sum, row) => sum + row.count, 0), byStatus: ordersByStatus },
      recentOrders: recent.orders, latestProducts, lowStockProducts };
  },
};
