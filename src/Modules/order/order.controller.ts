import type { RequestHandler } from "express";
import { orderService } from "./order.service";
import type { CheckoutDTO } from "./order.dto";

class OrderController {
  checkout: RequestHandler<{}, {}, CheckoutDTO> = async (req, res): Promise<void> => {
    const data = await orderService.checkout(req.user!._id, req.body);
    res.status(201).json({ success: true, message: "Order placed successfully", data });
  };
}
export const orderController = new OrderController();
