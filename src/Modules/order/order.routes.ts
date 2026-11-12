import { adminAuthentication } from '../admin/admin.authorization';
import { Router } from 'express';
import { orderController } from './order.controller';
import { authentication } from '../../Middlewares/authentication.middlewares';
import { TokenTypeEnum } from '../../Utils/security/token';
import { RoleEnum } from '../../DB/models/user/user.interface';
const router = Router();
const admin = adminAuthentication();
const customer = authentication(TokenTypeEnum.ACCESS, [RoleEnum.USER]);
// Literal admin paths precede customer identifiers. Services validate every entry point.
router.get('/admin', admin, orderController.adminList);
router.get('/admin/:orderId', admin, orderController.adminDetails);
router.patch('/admin/:orderId/status', admin, orderController.transition);
router.post('/checkout', customer, orderController.checkout);
router.get('/', customer, orderController.list);
router.get('/:orderId', customer, orderController.details);
router.patch('/:orderId/cancel', customer, orderController.cancel);
export const orderRouter = router;
