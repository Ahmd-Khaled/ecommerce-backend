import { Types, type QueryFilter } from 'mongoose';
import { BannerModel, type Banner, type BannerDocument } from '../models/banner/banner.model';
import type { CreateBannerDTO } from '../../Modules/banner/banner.dto';
import { pagination } from '../../Utils/pagination';

export const bannerRepository = {
  create(data: CreateBannerDTO, createdBy: Types.ObjectId, id?: Types.ObjectId) {
    return new BannerModel({ ...data, createdBy, ...(id ? { _id: id } : {}) }).save();
  },
  findById(id: string) { return BannerModel.findById(id).exec(); },
  save(banner: BannerDocument) { return banner.save(); },
  delete(id: string) { return BannerModel.findByIdAndDelete(id).exec(); },
  async list(filter: QueryFilter<Banner>, page: number, limit: number, publicOnly = false) {
    const [banners, total] = await Promise.all([
      BannerModel.find(filter).select(publicOnly ? '-createdBy -__v -updatedAt' : '-__v')
        .sort({ sortOrder: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      BannerModel.countDocuments(filter).exec(),
    ]);
    return { banners, pagination: pagination(page, limit, total) };
  },
};
