
import type {
  HydratedDocument,
  Model,
  Types,
} from "mongoose";

// ============================================================================
// Token Interface
// ============================================================================

export interface IToken {
  jti: string;
  expiresAt: Date;
  userId: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
}

// ============================================================================
// Mongoose Document & Model Types
// ============================================================================

export type HTokenDocument = HydratedDocument<IToken>;

export type TokenModelType = Model<
  IToken,
  {},
  {},
  {},
  HTokenDocument
>;
