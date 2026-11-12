import { model, models, Schema, type Model } from 'mongoose';
import { AdminRoleEnum, type IAdmin } from './admin.interface';
import { generateHash } from '../../../Utils/security/hash';

export const AdminSchema = new Schema<IAdmin>({
  firstName: { type: String, required: true, trim: true, minlength: 2, maxlength: 30 },
  lastName: { type: String, required: true, trim: true, minlength: 2, maxlength: 30 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: Object.values(AdminRoleEnum), default: AdminRoleEnum.ADMIN, required: true },
  freezedAt: Date,
  deletedAt: Date,
  tokenVersion: { type: Number, default: 0, min: 0, required: true },
}, {
  timestamps: true,
  optimisticConcurrency: true,
  toJSON: { transform: (_doc, ret) => { delete (ret as Partial<IAdmin>).password; return ret; } },
  toObject: { transform: (_doc, ret) => { delete (ret as Partial<IAdmin>).password; return ret; } },
});
AdminSchema.pre('save', async function () {
  if (this.isModified('password')) this.password = await generateHash(this.password);
});
AdminSchema.index({ role: 1, createdAt: -1, _id: -1 });
export const AdminModel = (models.Admin as Model<IAdmin> | undefined) ?? model<IAdmin>('Admin', AdminSchema);
