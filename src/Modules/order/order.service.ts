import { Types } from "mongoose";
import { orderRepository } from "../../DB/repository/order.repository";
import type { CheckoutDTO } from "./order.dto";
import { checkoutSchema } from "./order.validation";
import { BadRequestException, ConflictException } from "../../Utils/response/error.response";

class OrderService {
  async checkout(user: Types.ObjectId, input: CheckoutDTO) {
    const parsed = checkoutSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException("Invalid checkout request");
    try {
      return await orderRepository.checkout(user, parsed.data);
    } catch (error) {
      // An unknown commit result must not be reported as safe to retry.
      const failure = error as { hasErrorLabel?: (label: string) => boolean };
      if (failure.hasErrorLabel?.("TransientTransactionError") &&
          !failure.hasErrorLabel?.("UnknownTransactionCommitResult")) {
        throw new ConflictException("Checkout conflicted with another update; refresh cart");
      }
      throw error;
    }
  }
}
export const orderService = new OrderService();
