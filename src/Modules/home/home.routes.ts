import { Router } from 'express';
import { validations } from '../../Middlewares/validation.middlewares';
import { homeController } from './home.controller';
import { homeSchema, homeProductsSchema } from './home.validation';
export const homeRouter = Router();
// No application cache: stock, payments, visibility, and schedules change independently.
homeRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
homeRouter.get('/', validations({ query: homeSchema }), homeController.overview);
homeRouter.get('/products', validations({ query: homeProductsSchema }), homeController.products);
