import { Router } from 'express';
import { authentication } from '../../Middlewares/authentication.middlewares';
import { validations } from '../../Middlewares/validation.middlewares';
import { RoleEnum } from '../../DB/models/user/user.interface';
import { TokenTypeEnum } from '../../Utils/security/token';
import { wishlistController } from './wishlist.controller';
import { addWishlistItemSchema, wishlistListSchema, wishlistProductIdSchema } from './wishlist.validation';

const router = Router();
router.use(authentication(TokenTypeEnum.ACCESS, [RoleEnum.USER]));
router.get('/', validations(wishlistListSchema), wishlistController.list);
router.post('/items', validations({ body: addWishlistItemSchema }), wishlistController.add);
router.get('/items/:productId', validations({ params: wishlistProductIdSchema }), wishlistController.state);
router.delete('/items/:productId', validations({ params: wishlistProductIdSchema }), wishlistController.remove);
export const wishlistRouter = router;
