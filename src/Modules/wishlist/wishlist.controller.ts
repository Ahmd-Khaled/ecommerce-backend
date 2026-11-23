import type { RequestHandler } from 'express';
import { wishlistService } from './wishlist.service';

export const wishlistController = {
  list: (async (req, res) => { const data = await wishlistService.list(req.user!._id, req.query as any); res.json({ success: true, message: 'Wishlist retrieved successfully', data }); }) as RequestHandler,
  add: (async (req, res) => { const data = await wishlistService.add(req.user!._id, req.body.productId); res.status(data.added ? 201 : 200).json({ success: true, message: data.added ? 'Favorite added successfully' : 'Favorite already exists', data: { isFavorited: data.isFavorited } }); }) as RequestHandler,
  remove: (async (req, res) => { const data = await wishlistService.remove(req.user!._id, String(req.params.productId)); res.json({ success: true, message: 'Favorite removed successfully', data }); }) as RequestHandler,
  state: (async (req, res) => { const data = await wishlistService.state(req.user!._id, String(req.params.productId)); res.json({ success: true, data }); }) as RequestHandler,
};
