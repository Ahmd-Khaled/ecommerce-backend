import type { RequestHandler } from 'express';
import { uploadExpected, uploadId } from '../../Middlewares/upload.middlewares';
import { requireAdmin } from '../admin/admin.authorization';
import { translate } from '../../Utils/i18n';
import { bannerService } from './banner.service';
import type { AdminBannerDTO, PublicBannerDTO, CreateBannerDTO, UpdateBannerDTO } from './banner.dto';

class BannerController {
  publicList: RequestHandler = async (req, res) => {
    const data = await bannerService.publicList(req.query as unknown as PublicBannerDTO, req.language);
    res.json({ success: true, message: translate(req.language, 'retrieved'), data });
  };
  adminList: RequestHandler = async (req, res) => {
    const data = await bannerService.adminList(req.query as unknown as AdminBannerDTO);
    res.json({ success: true, message: translate(req.language, 'retrieved'), data });
  };
  details: RequestHandler = async (req, res) => {
    const banner = await bannerService.details(String(req.params.bannerId));
    res.json({ success: true, message: translate(req.language, 'retrieved'), data: { banner } });
  };
  create: RequestHandler<{}, {}, CreateBannerDTO> = async (req, res) => {
    requireAdmin(req.admin);
    const banner = await bannerService.create(req.body, req.admin._id, uploadId(req));
    res.status(201).json({ success: true, message: translate(req.language, 'bannerCreated'), data: { banner } });
  };
  update: RequestHandler<{ bannerId: string }, {}, UpdateBannerDTO> = async (req, res) => {
    const banner = await bannerService.update(req.params.bannerId, req.body, uploadExpected(req));
    res.json({ success: true, message: translate(req.language, 'bannerUpdated'), data: { banner } });
  };
  delete: RequestHandler = async (req, res) => {
    await bannerService.delete(String(req.params.bannerId));
    res.json({ success: true, message: translate(req.language, 'bannerDeleted') });
  };
}
export const bannerController = new BannerController();
