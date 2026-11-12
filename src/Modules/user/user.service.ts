import { UserModel } from '../../DB/models/user/user.model';
import { RoleEnum, type HUserDocument } from '../../DB/models/user/user.interface';
import type { HAdminDocument } from '../../DB/models/admin/admin.interface';
import { requireAdmin } from '../admin/admin.authorization';
import { accountFilter, accountWriteError, parseAccount } from '../admin/admin.helpers';
import { accountIdSchema } from '../admin/admin.validation';
import { createUserSchema, updateUserSchema, userListSchema } from './user.validation';
import { NotFoundException } from '../../Utils/response/error.response';
import { generateOTP } from '../../Utils/generateOTP';

const projection = 'firstName lastName email role confirmedAt freezedAt deletedAt createdAt updatedAt';
const safeUser = (user: HUserDocument) => ({ id: String(user._id), firstName: user.firstName, lastName: user.lastName,
  email: user.email, role: user.role, confirmedAt: user.confirmedAt,
  status: user.deletedAt ? 'deleted' : user.freezedAt ? 'frozen' : user.confirmedAt ? 'active' : 'pending',
  createdAt: user.createdAt, updatedAt: user.updatedAt });
class UserService {
  async list(actor: HAdminDocument, input: unknown) {
    requireAdmin(actor);
    const query = parseAccount(userListSchema, input);
    const filter = { ...accountFilter(query), role: query.role ?? { $in: Object.values(RoleEnum) },
      ...(query.status === 'active' ? { confirmedAt: { $ne: null } } : {}),
      ...(query.status === 'pending' ? { confirmedAt: null } : {}) };
    const [docs, total] = await Promise.all([
      UserModel.find(filter).select(projection).sort({ createdAt: -1, _id: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).exec(),
      UserModel.countDocuments(filter).exec(),
    ]);
    return { users: docs.map(safeUser), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }
  async details(actor: HAdminDocument, input: unknown) {
    requireAdmin(actor);
    const { id } = parseAccount(accountIdSchema, { id: input });
    const user = await UserModel.findOne({ _id: id, role: { $in: Object.values(RoleEnum) } }).select(projection).exec();
    if (!user) throw new NotFoundException('User not found');
    return safeUser(user);
  }
  async create(actor: HAdminDocument, input: unknown) {
    requireAdmin(actor);
    const data = parseAccount(createUserSchema, input);
    const now = new Date();
    try {
      return safeUser(await UserModel.create({ ...data, confirmEmailOTP: generateOTP(),
        confirmEmailOTPExpiresAt: new Date(now.getTime() + 600000), confirmEmailOTPSentAt: now,
        confirmEmailOTPResendWindowStartedAt: now, confirmEmailOTPResendCount: 0, confirmEmailOTPAttempts: 0 }));
    } catch (error) { return accountWriteError(error); }
  }
  async update(actor: HAdminDocument, input: unknown, body: unknown, remove = false) {
    requireAdmin(actor);
    const { id } = parseAccount(accountIdSchema, { id: input });
    const data = remove ? {} : parseAccount(updateUserSchema, body);
    const { status, ...fields } = data;
    const current = await UserModel.findOne({ _id: id, deletedAt: null, role: { $in: Object.values(RoleEnum) } }).exec();
    if (!current) throw new NotFoundException('User not found');
    const slug = ((fields.firstName ?? current.firstName) + ' ' + (fields.lastName ?? current.lastName))
      .trim().normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
    const user = await UserModel.findOneAndUpdate({ _id: id, tokenVersion: current.tokenVersion, deletedAt: null, role: { $in: Object.values(RoleEnum) } }, {
      $set: { ...fields, slug, ...(status === 'frozen' ? { freezedAt: new Date() } : {}), ...(remove ? { deletedAt: new Date() } : {}) },
      ...(status === 'active' ? { $unset: { freezedAt: 1 } } : {}),
      $inc: { tokenVersion: 1 },
    }, { returnDocument: 'after', runValidators: true }).select(projection).exec();
    if (!user) throw new NotFoundException('User not found');
    return safeUser(user);
  }
}
export const userService = new UserService();
