import type { z } from "zod";
import type { createAddressSchema, updateAddressSchema, addressIdSchema } from "./address.validation";

export type CreateAddressDTO = z.infer<typeof createAddressSchema>;
export type UpdateAddressDTO = z.infer<typeof updateAddressSchema>;
export type AddressIdDTO = z.infer<typeof addressIdSchema>;
