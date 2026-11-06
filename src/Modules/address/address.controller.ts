import type { RequestHandler } from "express";
import type { AddressIdDTO, CreateAddressDTO, UpdateAddressDTO } from "./address.dto";
import { addressService } from "./address.service";

class AddressController {
  listAddresses: RequestHandler = async (req, res) => {
    const data = await addressService.listAddresses(req.user!._id);
    res.status(200).json({ success: true, message: "Addresses retrieved successfully", data });
  };
  createAddress: RequestHandler<{}, {}, CreateAddressDTO> = async (req, res) => {
    const data = await addressService.createAddress(req.user!._id, req.body);
    res.status(201).json({ success: true, message: "Address created successfully", data });
  };
  updateAddress: RequestHandler<AddressIdDTO, {}, UpdateAddressDTO> = async (req, res) => {
    const data = await addressService.updateAddress(req.user!._id, req.params.addressId, req.body);
    res.status(200).json({ success: true, message: "Address updated successfully", data });
  };
  setDefaultAddress: RequestHandler<AddressIdDTO> = async (req, res) => {
    const data = await addressService.setDefaultAddress(req.user!._id, req.params.addressId);
    res.status(200).json({ success: true, message: "Default address updated successfully", data });
  };
  deleteAddress: RequestHandler<AddressIdDTO> = async (req, res) => {
    const data = await addressService.deleteAddress(req.user!._id, req.params.addressId);
    res.status(200).json({ success: true, message: "Address deleted successfully", data });
  };
}

export const addressController = new AddressController();
