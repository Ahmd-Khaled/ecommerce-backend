import { authentication } from '../../Middlewares/authentication.middlewares';
import { TokenTypeEnum } from '../../Utils/security/token';
import { RoleEnum } from '../../DB/models/user/user.interface';
export const paymentCustomer = authentication(TokenTypeEnum.ACCESS, [RoleEnum.USER]);
