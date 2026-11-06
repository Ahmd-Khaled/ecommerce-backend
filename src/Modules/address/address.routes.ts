import { Router } from "express";
import { authentication } from "../../Middlewares/authentication.middlewares";
import { validations } from "../../Middlewares/validation.middlewares";
import { addressController } from "./address.controller";
import { addressIdSchema, createAddressSchema, updateAddressSchema, setDefaultAddressSchema } from "./address.validation";

const router = Router();
router.use(authentication());
router.get("/", addressController.listAddresses);
router.post("/", validations({ body: createAddressSchema }), addressController.createAddress);
router.patch("/:addressId", validations({ params: addressIdSchema, body: updateAddressSchema }), addressController.updateAddress);
router.patch("/:addressId/default", validations({ params: addressIdSchema, body: setDefaultAddressSchema }), addressController.setDefaultAddress);
router.delete("/:addressId", validations({ params: addressIdSchema }), addressController.deleteAddress);

export const addressRouter = router;
