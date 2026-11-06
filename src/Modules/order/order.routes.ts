import { Router } from "express";
import { orderController } from "./order.controller";
import { checkoutSchema } from "./order.validation";
import { validations } from "../../Middlewares/validation.middlewares";
import { authentication } from "../../Middlewares/authentication.middlewares";
import { TokenTypeEnum } from "../../Utils/security/token";
import { RoleEnum } from "../../DB/models/user/user.interface";

const router = Router();

router.use(authentication(TokenTypeEnum.ACCESS, [RoleEnum.USER]));
router.post("/checkout", validations({ body: checkoutSchema }), orderController.checkout);

export const orderRouter = router;
