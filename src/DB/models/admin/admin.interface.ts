import type { HydratedDocument } from 'mongoose';

export enum AdminRoleEnum {
  ADMIN = 'admin',
  SUPER_ADMIN = 'super-admin',
}
export interface IAdmin {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: AdminRoleEnum;
  freezedAt?: Date;
  deletedAt?: Date;
  tokenVersion: number;
  createdAt?: Date;
  updatedAt?: Date;
}
export type HAdminDocument = HydratedDocument<IAdmin>;
