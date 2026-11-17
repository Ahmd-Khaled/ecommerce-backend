import type { RequestHandler } from 'express';
import { reviewService } from './review.service';

export const reviewController: Record<'publicList' | 'create' | 'mine' | 'edit' | 'withdraw' | 'adminList' | 'moderate' | 'restore' | 'getSettings' | 'setSettings', RequestHandler> = {
  publicList: async (req, res) => { const data = await reviewService.publicList(String(req.params.productId), req.query); res.json({ success: true, data }); },
  create: async (req, res) => { const data = await reviewService.create(req.user!, String(req.params.productId), req.body); res.status(201).json({ success: true, data }); },
  mine: async (req, res) => { const data = await reviewService.mine(req.user!, req.query); res.json({ success: true, data }); },
  edit: async (req, res) => { const data = await reviewService.edit(req.user!, String(req.params.reviewId), req.body); res.json({ success: true, data }); },
  withdraw: async (req, res) => { const data = await reviewService.withdraw(req.user!, String(req.params.reviewId)); res.json({ success: true, data }); },
  adminList: async (req, res) => { const data = await reviewService.adminList(req.query); res.json({ success: true, data }); },
  moderate: async (req, res) => { const data = await reviewService.moderate(req.admin!, String(req.params.reviewId), req.body); res.json({ success: true, data }); },
  restore: async (req, res) => { const data = await reviewService.restore(req.admin!, String(req.params.reviewId), (req.body as { reason?: string }).reason); res.json({ success: true, data }); },
  getSettings: async (_req, res) => { const data = await reviewService.getSettings(); res.json({ success: true, data }); },
  setSettings: async (req, res) => { const data = await reviewService.setSettings(req.body); res.json({ success: true, data }); },
};
