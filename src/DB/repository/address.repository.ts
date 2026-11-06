import { Types } from "mongoose";
import { UserModel } from "../models/user/user.model";
import type { IUserAddress } from "../models/user/user.interface";

class AddressRepository {
  async findByUser(userId: Types.ObjectId) {
    // Lean reads preserve legacy addresses without generating transient IDs.
    return UserModel.findById(userId).select("address").lean().exec();
  }

  async replace(userId: Types.ObjectId, previous: IUserAddress[] | undefined, addresses: IUserAddress[]) {
    // Compare the raw array to avoid overwriting any concurrent address change.
    // Use the collection so Mongoose cannot add IDs to the legacy filter.
    const result = await UserModel.collection.updateOne(
      { _id: userId, address: previous === undefined ? { $exists: false } : previous },
      { $set: { address: addresses, updatedAt: new Date() }, $inc: { __v: 1 } },
    );
    return result.matchedCount === 1;
  }
}

export const addressRepository = new AddressRepository();
