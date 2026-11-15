import type { RequestHandler } from 'express';
import { translate } from '../../Utils/i18n';
import { homeService } from './home.service';
import type { HomeDTO, HomeProductsDTO } from './home.dto';
export const homeController: Record<'overview' | 'products', RequestHandler> = {
  overview: async (req, res) => {
    const data = await homeService.overview(req.query as unknown as HomeDTO, req.language);
    res.json({ success: true, message: translate(req.language, 'retrieved'), data });
  },
  products: async (req, res) => {
    const data = await homeService.products(req.query as unknown as HomeProductsDTO);
    res.json({ success: true, message: translate(req.language, 'retrieved'), data });
  },
};
