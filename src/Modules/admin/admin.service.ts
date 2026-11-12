import { AdminModel } from '../../DB/models/admin/admin.model';
import { AdminRoleEnum, type HAdminDocument } from '../../DB/models/admin/admin.interface';
import { requireAdmin } from './admin.authorization';
import { accountFilter, accountWriteError, parseAccount } from './admin.helpers';
import { accountIdSchema, adminListSchema, createAdminSchema, updateAdminSchema } from './admin.validation';
import { ForbiddenException, NotFoundException } from '../../Utils/response/error.response';

export const adminProjection = 'firstName lastName email role freezedAt deletedAt createdAt updatedAt';
export const safeAdmin = (admin: HAdminDocument) => ({ id: String(admin._id), firstName: admin.firstName,
  lastName: admin.lastName, email: admin.email, role: admin.role,
  status: admin.deletedAt ? 'deleted' : admin.freezedAt ? 'frozen' : 'active', createdAt: admin.createdAt, updatedAt: admin.updatedAt });

class AdminService {
  async list(actor: HAdminDocument, input: unknown) {
    requireAdmin(actor, true);
    const query = parseAccount(adminListSchema, input);
    const filter = { ...accountFilter(query), role: query.role ?? { $in: Object.values(AdminRoleEnum) } };
    const [docs, count] = await Promise.all([
      AdminModel.find(filter).select(adminProjection).sort({ createdAt: -1, _id: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).exec(),
      AdminModel.countDocuments(filter).exec(),
    ]);
    return { admins: docs.map(safeAdmin), pagination: { page: query.page, limit: query.limit, total: count, totalPages: Math.ceil(count / query.limit) } };
  }
  async details(actor: HAdminDocument, input: unknown) {
    requireAdmin(actor, true);
    const { id } = parseAccount(accountIdSchema, { id: input });
    const admin = await AdminModel.findById(id).select(adminProjection).exec();
    if (!admin) throw new NotFoundException('Administrator not found');
    return safeAdmin(admin);
  }
  async create(actor: HAdminDocument, input: unknown) {
    requireAdmin(actor, true);
    const data = parseAccount(createAdminSchema, input);
    try { return safeAdmin(await AdminModel.create(data)); } catch (error) { return accountWriteError(error); }
  }
  async update(actor: HAdminDocument, input: unknown, body: unknown, remove = false) {
    requireAdmin(actor, true);
    const { id } = parseAccount(accountIdSchema, { id: input });
    const data = remove ? {} : parseAccount(updateAdminSchema, body);
    if (String(actor._id) === id) throw new ForbiddenException('Use your own profile and password endpoints');
    // Super-admin identities are protected from destructive API changes. This also
    // prevents concurrent requests from removing the last recovery administrator.
    const target = await AdminModel.findById(id).exec();
    if (!target || target.deletedAt) throw new NotFoundException('Administrator not found');
    if (target.role === AdminRoleEnum.SUPER_ADMIN) throw new ForbiddenException('Super-admin accounts are protected');
    const { status, ...fields } = data;
    const updated = await AdminModel.findOneAndUpdate({ _id: id, role: AdminRoleEnum.ADMIN, deletedAt: null }, {
      $set: { ...fields, ...(status === 'frozen' ? { freezedAt: new Date() } : {}), ...(remove ? { deletedAt: new Date() } : {}) },
      ...(status === 'active' ? { $unset: { freezedAt: 1 } } : {}),
      $inc: { tokenVersion: 1 },
    }, { returnDocument: 'after', runValidators: true }).exec();
    if (!updated) throw new NotFoundException('Administrator changed or is unavailable');
    return safeAdmin(updated);
  }
}
export const adminService = new AdminService();
