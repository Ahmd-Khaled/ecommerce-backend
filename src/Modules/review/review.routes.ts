import { Router } from 'express';
import { validations } from '../../Middlewares/validation.middlewares';
import { authentication } from '../../Middlewares/authentication.middlewares';
import { TokenTypeEnum } from '../../Utils/security/token';
import { RoleEnum } from '../../DB/models/user/user.interface';
import { adminAuthentication } from '../admin/admin.authorization';
import { AdminRoleEnum } from '../../DB/models/admin/admin.interface';
import { reviewController } from './review.controller';
import { adminReviewsQuery, createReviewBody, moderationBody, myReviewsQuery, productIdParams, productReviewsQuery, restoreBody, reviewIdParams, settingsBody, updateReviewBody } from './review.validation';

export const customerReviewRouter = Router();
customerReviewRouter.get('/reviews/me', authentication(TokenTypeEnum.ACCESS, [RoleEnum.USER]), validations({ query: myReviewsQuery }), reviewController.mine);
customerReviewRouter.patch('/reviews/me/:reviewId', authentication(TokenTypeEnum.ACCESS, [RoleEnum.USER]), validations({ params: reviewIdParams, body: updateReviewBody }), reviewController.edit);
customerReviewRouter.delete('/reviews/me/:reviewId', authentication(TokenTypeEnum.ACCESS, [RoleEnum.USER]), validations({ params: reviewIdParams }), reviewController.withdraw);
customerReviewRouter.get('/:productId/reviews', validations({ params: productIdParams, query: productReviewsQuery }), reviewController.publicList);
customerReviewRouter.post('/:productId/reviews', authentication(TokenTypeEnum.ACCESS, [RoleEnum.USER]), validations({ params: productIdParams, body: createReviewBody }), reviewController.create);

export const adminReviewRouter = Router();
adminReviewRouter.use(adminAuthentication());
adminReviewRouter.get('/settings', reviewController.getSettings);
adminReviewRouter.patch('/settings', validations({ body: settingsBody }), reviewController.setSettings);
adminReviewRouter.get('/', validations({ query: adminReviewsQuery }), reviewController.adminList);
adminReviewRouter.patch('/:reviewId/state', validations({ params: reviewIdParams, body: moderationBody }), reviewController.moderate);
adminReviewRouter.patch('/:reviewId/restore', adminAuthentication([AdminRoleEnum.SUPER_ADMIN]), validations({ params: reviewIdParams, body: restoreBody }), reviewController.restore);
