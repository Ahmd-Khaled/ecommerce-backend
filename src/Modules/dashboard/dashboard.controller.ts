import type { RequestHandler } from 'express';
import { translate } from '../../Utils/i18n';
import { dashboardService } from './dashboard.service';
import type { OverviewDTO, SalesDTO, TopProductsDTO } from './dashboard.dto';
export const dashboardController: Record<'overview' | 'sales' | 'topProducts', RequestHandler> = {
  overview: async (req, res) => {
    const data = await dashboardService.overview(req.query as unknown as OverviewDTO);
    res.json({ success: true, message: translate(req.language, 'retrieved'), data });
  },
  sales: async (req, res) => {
    const data = await dashboardService.sales(req.query as unknown as SalesDTO);
    res.json({ success: true, message: translate(req.language, 'retrieved'), data });
  },
  topProducts: async (req, res) => {
    const data = await dashboardService.topProducts(req.query as unknown as TopProductsDTO);
    res.json({ success: true, message: translate(req.language, 'retrieved'), data });
  },
};
