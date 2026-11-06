import { Types } from "mongoose";
import type { IUserAddress } from "../../DB/models/user/user.interface";
import { addressRepository } from "../../DB/repository/address.repository";
import { ConflictException, NotFoundException } from "../../Utils/response/error.response";
import type { CreateAddressDTO, UpdateAddressDTO } from "./address.dto";

class AddressService {
  private async mutate(userId: Types.ObjectId, change: (addresses: IUserAddress[]) => void) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const user = await addressRepository.findByUser(userId);
      if (!user) throw new NotFoundException("User not found");
      let hasDefault = false;
      const addresses: IUserAddress[] = (user.address ?? []).map(address => {
        const isDefault = Boolean(address.isDefault) && !hasDefault;
        hasDefault ||= isDefault;
        return { ...address, _id: address._id ?? new Types.ObjectId(), isDefault };
      });
      change(addresses);
      if (JSON.stringify(addresses) === JSON.stringify(user.address ?? [])) return addresses;
      if (await addressRepository.replace(userId, user.address, addresses)) return addresses;
    }
    throw new ConflictException("Addresses changed concurrently. Please retry");
  }

  private find(addresses: IUserAddress[], addressId: string) {
    const address = addresses.find(item => item._id?.toString() === addressId.toLowerCase());
    if (!address) throw new NotFoundException("Address not found");
    return address;
  }

  listAddresses(userId: Types.ObjectId) {
    return this.mutate(userId, () => {});
  }

  async createAddress(userId: Types.ObjectId, input: CreateAddressDTO) {
    const id = new Types.ObjectId();
    const addresses = await this.mutate(userId, addresses => {
      const address: IUserAddress = {
        _id: id, label: input.label, fullName: input.fullName, phone: input.phone,
        country: input.country, city: input.city, street: input.street,
        isDefault: input.isDefault ?? addresses.length === 0,
      };
      if (input.building !== undefined) address.building = input.building;
      if (input.apartment !== undefined) address.apartment = input.apartment;
      if (address.isDefault) addresses.forEach(item => { item.isDefault = false; });
      addresses.push(address);
    });
    return this.find(addresses, id.toString());
  }

  async updateAddress(userId: Types.ObjectId, addressId: string, input: UpdateAddressDTO) {
    const addresses = await this.mutate(userId, addresses => {
      const address = this.find(addresses, addressId);
      if (input.isDefault === true) addresses.forEach(item => { item.isDefault = false; });
      Object.assign(address, Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)));
    });
    return this.find(addresses, addressId);
  }

  setDefaultAddress(userId: Types.ObjectId, addressId: string) {
    return this.updateAddress(userId, addressId, { isDefault: true });
  }

  deleteAddress(userId: Types.ObjectId, addressId: string) {
    return this.mutate(userId, addresses => {
      const address = this.find(addresses, addressId);
      addresses.splice(addresses.indexOf(address), 1);
      if (address.isDefault && addresses[0]) addresses[0].isDefault = true;
    });
  }
}

export const addressService = new AddressService();
