import type { PipelineStage } from 'mongoose';
import { ProductModel } from '../models/product/product.model';
import { CategoryModel } from '../models/category/category.model';
import { OrderModel } from '../models/order/order.model';
import { paidProductStages } from './reporting.repository';
import { pagination } from '../../Utils/pagination';
import { storeMoney } from '../../Utils/money';
import type { HomeProductsDTO } from '../../Modules/home/home.dto';

export function visibleCategoryStages(): PipelineStage[] {
  return [
    { $graphLookup: { from: CategoryModel.collection.name, startWith: '$category',
      connectFromField: 'parent', connectToField: '_id', as: '_ancestors',
      restrictSearchWithMatch: { isActive: true } } },
    // With a single parent chain, reaching a root proves that the category and
    // all ancestors exist and are active. Orphans and cycles cannot reach a root.
    { $match: { $expr: { $anyElementTrue: [{ $map: { input: '$_ancestors', as: 'ancestor',
      in: { $eq: [{ $ifNull: ['$$ancestor.parent', null] }, null] } } }] } } },
    { $unset: '_ancestors' },
  ];
}
export function homeProductPipeline(section: HomeProductsDTO['section']): PipelineStage[] {
  const validOffer = { $and: [{ $gt: ['$price', 0] }, { $gt: ['$compareAtPrice', '$price'] }] };
  const pipeline: PipelineStage[] = section === 'best-sellers' ? [
    ...paidProductStages(),
    { $lookup: { from: ProductModel.collection.name, localField: '_id', foreignField: '_id', as: 'product' } },
    { $unwind: '$product' },
    { $replaceRoot: { newRoot: { $mergeObjects: ['$product', { unitsSold: '$unitsSold' }] } } },
  ] : [];
  pipeline.push({ $match: { isActive: true, stock: { $gt: 0 },
    ...(section === 'best-offers' ? { $expr: validOffer } : {}),
  } });
  // Sort before the ancestry lookup so latest products can use the catalog index.
  if (section === 'latest') pipeline.push({ $sort: { createdAt: -1, _id: -1 } });
  pipeline.push(...visibleCategoryStages(),
  { $set: {
    savings: { $cond: [validOffer, { $subtract: ['$compareAtPrice', '$price'] }, 0] },
    discountPercentage: { $cond: [validOffer,
      { $multiply: [{ $divide: [{ $subtract: ['$compareAtPrice', '$price'] }, '$compareAtPrice'] }, 100] }, 0] },
  } });
  if (section !== 'latest') pipeline.push({ $sort: section === 'best-offers'
    ? { discountPercentage: -1, createdAt: -1, _id: -1 } : { unitsSold: -1, _id: 1 } });
  return pipeline;
}
export const homeRepository = {
  async products({ section, page, limit }: HomeProductsDTO) {
    const { currency, currencyExponent } = storeMoney();
    const pipeline: PipelineStage[] = [...homeProductPipeline(section), { $facet: {
      products: [{ $skip: (page - 1) * limit }, { $limit: limit }, { $project: {
        _id: 1, name: 1, slug: 1, price: 1, compareAtPrice: 1, stock: 1, images: 1, category: 1, createdAt: 1,
        ...(section === 'best-sellers' ? { unitsSold: 1 } : {}),
        savings: { $round: ['$savings', currencyExponent] }, discountPercentage: { $round: ['$discountPercentage', 2] },
      } }], total: [{ $count: 'count' }],
    } }];
    const model = section === 'best-sellers' ? OrderModel : ProductModel;
    const [result] = await model.aggregate<{ products: Record<string, unknown>[]; total: { count: number }[] }>(pipeline)
      .option({ maxTimeMS: 15000 }).exec();
    return { products: result?.products ?? [], currency, currencyExponent,
      pagination: pagination(page, limit, result?.total[0]?.count ?? 0) };
  },
};
