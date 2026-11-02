
import {
  model,
  models,
  Schema,
} from "mongoose";

import type {
  IToken,
  TokenModelType,
} from "./token.interface";

export const TokenSchema = new Schema<IToken>(
  {
    jti: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    expiresAt: {
      type: Date,
      required: true,
      expires: 0,
    },

    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "User",
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export const TokenModel: TokenModelType =
  (models.Token as TokenModelType | undefined) ??
  model<IToken>("Token", TokenSchema);
