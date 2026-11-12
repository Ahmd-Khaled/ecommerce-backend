import { DatabaseRepository } from './db.repository';
import { AdminModel } from '../models/admin/admin.model';
import type { IAdmin } from '../models/admin/admin.interface';
import type { Types } from 'mongoose';

class AdminRepository extends DatabaseRepository<IAdmin> {
  constructor() { super(AdminModel); }
  findByEmailWithPassword(email: string) {
    return AdminModel.findOne({ email: email.trim().toLowerCase() }).select('+password').exec();
  }
  incrementTokenVersion(id: Types.ObjectId) {
    return AdminModel.findByIdAndUpdate(id, { $inc: { tokenVersion: 1 } }, { returnDocument: 'after' }).exec();
  }
}
export const adminRepository = new AdminRepository();
