import type { RequestHandler } from 'express';
import { orderService } from './order.service';
class OrderController {
  checkout: RequestHandler = async (req, res) => {
    const result = await orderService.checkout(
      req.user!._id,
      req.body,
      req.headers['idempotency-key'],
    );
    res
      .status(result.replayed ? 200 : 201)
      .json({ success: true, replayed: result.replayed, data: result.order });
  };
  list: RequestHandler = async (req, res) => {
    res.json({
      success: true,
      data: await orderService.list(req.user!._id, req.query),
    });
  };
  details: RequestHandler = async (req, res) => {
    res.json({
      success: true,
      data: await orderService.details(req.params.orderId, req.user!._id),
    });
  };
  cancel: RequestHandler = async (req, res) => {
    res.json({
      success: true,
      data: await orderService.cancel(req.user!._id, req.params.orderId, req.body ?? {}),
    });
  };
  adminList: RequestHandler = async (req, res) => {
    res.json({ success: true, data: await orderService.adminList(req.query) });
  };
  adminDetails: RequestHandler = async (req, res) => {
    res.json({
      success: true,
      data: await orderService.details(req.params.orderId),
    });
  };
  transition: RequestHandler = async (req, res) => {
    res.json({
      success: true,
      data: await orderService.transition(req.admin!._id, req.params.orderId, req.body),
    });
  };
}
export const orderController = new OrderController();
