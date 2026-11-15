import { Error as MongooseError, type Types, type QueryFilter } from 'mongoose';
import { bannerRepository } from '../../DB/repository/banner.repository';
import type { Banner } from '../../DB/models/banner/banner.model';
import type { Language } from '../../Utils/i18n';
import { BadRequestException, ConflictException, NotFoundException } from '../../Utils/response/error.response';
import type { CreateBannerDTO, UpdateBannerDTO, AdminBannerDTO, PublicBannerDTO } from './banner.dto';

export function publicBannerFilter(language: Language, view: PublicBannerDTO['view'], now = new Date()): QueryFilter<Banner> {
  return { language, view, isActive: true, $and: [
    { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
    { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
  ] };
}
export const bannerService = {
  create(data: CreateBannerDTO, actor: Types.ObjectId, id?: Types.ObjectId) {
    return bannerRepository.create(data, actor, id);
  },
  async details(id: string) {
    const banner = await bannerRepository.findById(id);
    if (!banner) throw new NotFoundException('Banner not found');
    return banner;
  },
  publicList(query: PublicBannerDTO, language: Language) {
    return bannerRepository.list(publicBannerFilter(language, query.view), query.page, query.limit, true);
  },
  adminList(query: AdminBannerDTO) {
    const { page, limit } = query;
    const filter: QueryFilter<Banner> = {
      ...(query.view !== undefined ? { view: query.view } : {}),
      ...(query.language !== undefined ? { language: query.language } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };
    return bannerRepository.list(filter, page, limit);
  },
  async update(id: string, data: UpdateBannerDTO, expected?: { value: unknown }) {
    const banner = await this.details(id);
    if (data.image !== undefined && expected && banner.image !== expected.value)
      throw new ConflictException('Image changed during upload; retry');
    banner.set(data);
    if (banner.startsAt && banner.endsAt && banner.endsAt <= banner.startsAt)
      throw new BadRequestException('End must be after start');
    try { return await bannerRepository.save(banner); }
    catch (error) {
      if (error instanceof MongooseError.VersionError || error instanceof MongooseError.DocumentNotFoundError)
        throw new ConflictException('Banner changed; refresh and retry');
      throw error;
    }
  },
  async delete(id: string) {
    if (!await bannerRepository.delete(id)) throw new NotFoundException('Banner not found');
    // Shared reconciliation removes unreferenced media after its retention period.
  },
};
