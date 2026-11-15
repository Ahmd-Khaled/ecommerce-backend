import { z } from 'zod';
import { generalFields } from '../../Middlewares/validation.fields';
import { paginationFields } from '../../Utils/pagination';

export const bannerView = z.enum(['mobile', 'desktop']);
const language = z.enum(['ar', 'en']);
const link = z.string().trim().max(2048).refine((value) => {
  if (/^\/(?!\/)/.test(value)) return !/[\\\s\u0000-\u001f]/.test(value);
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}, 'Use a relative path or HTTP(S) URL');
const fields = {
  image: z.url(), language, view: bannerView,
  title: z.string().trim().max(150), altText: z.string().trim().max(300),
  linkUrl: link.nullable(),
  sortOrder: z.number().int().min(0).max(1000000), isActive: z.boolean(),
  startsAt: z.iso.datetime().nullable(), endsAt: z.iso.datetime().nullable(),
};
export const createBannerSchema = z.strictObject({
  ...fields, title: fields.title.optional(), altText: fields.altText.optional(),
  linkUrl: fields.linkUrl.optional(), sortOrder: fields.sortOrder.default(0),
  isActive: fields.isActive.default(true), startsAt: fields.startsAt.optional(), endsAt: fields.endsAt.optional(),
}).refine((value) => !value.startsAt || !value.endsAt || Date.parse(value.endsAt) > Date.parse(value.startsAt), 'End must be after start');
export const updateBannerSchema = z.strictObject(fields).partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
export const bannerIdSchema = z.strictObject({ bannerId: generalFields.id });
export const publicBannerSchema = z.strictObject({ view: bannerView, ...paginationFields });
export const adminBannerSchema = z.strictObject({
  ...paginationFields, view: bannerView.optional(), language: language.optional(),
  isActive: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});
