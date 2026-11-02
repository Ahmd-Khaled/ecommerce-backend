import { Model } from "mongoose";
import { DatabaseRepository } from "./db.repository";
import { IToken } from "../models/token/token.interface";

export class TokenRepository extends DatabaseRepository<IToken> {
  constructor(protected override readonly model: Model<IToken>) {
    super(model);
  }


}