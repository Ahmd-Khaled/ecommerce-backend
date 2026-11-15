import { Router } from 'express';
import { validations } from '../../Middlewares/validation.middlewares';
import { uploadLimiter, uploadRoute } from '../../Middlewares/upload.middlewares';
import { bannerUpload } from '../../Utils/storage/upload.policies';
import { adminAuthentication } from '../admin/admin.authorization';
import { bannerController as controller } from './banner.controller';
import { adminBannerSchema, bannerIdSchema, createBannerSchema, publicBannerSchema, updateBannerSchema } from './banner.validation';

export const bannerRouter = Router();
bannerRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
bannerRouter.get('/list', validations({ query: publicBannerSchema }), controller.publicList);
bannerRouter.use(adminAuthentication());
bannerRouter.get('/', validations({ query: adminBannerSchema }), controller.adminList);
bannerRouter.get('/:bannerId', validations({ params: bannerIdSchema }), controller.details);
bannerRouter.post('/', uploadLimiter, uploadRoute(bannerUpload, { body: createBannerSchema }, controller.create));
bannerRouter.patch('/:bannerId', uploadLimiter, uploadRoute(bannerUpload, { params: bannerIdSchema, body: updateBannerSchema }, controller.update));
bannerRouter.delete('/:bannerId', validations({ params: bannerIdSchema }), controller.delete);
