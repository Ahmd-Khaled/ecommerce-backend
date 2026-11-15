import type { UploadPolicy } from './storage.types';
const MB = 1024 * 1024;
export const bannerUpload: UploadPolicy = {
  module: 'banners', param: 'bannerId',
  fields: [{ name: 'image', folder: 'image', maxCount: 1, maxBytes: 5 * MB }],
  numbers: ['sortOrder'], booleans: ['isActive'], nullable: ['startsAt', 'endsAt', 'linkUrl'],
};
export const avatarUpload: UploadPolicy = {
  module: 'users',
  fields: [{ name: 'avatar', folder: 'avatar', maxCount: 1, maxBytes: 2 * MB }],
  json: ['address'],
  nullable: ['phone', 'gender'],
};
export const productUpload: UploadPolicy = {
  module: 'products',
  param: 'productId',
  fields: [
    {
      name: 'images',
      folder: 'images',
      maxCount: 10,
      maxBytes: 5 * MB,
      multiple: true,
    },
  ],
  numbers: ['price', 'compareAtPrice', 'stock'],
  booleans: ['isActive'],
  json: ['images'],
  nullable: ['compareAtPrice'],
};
export const categoryUpload: UploadPolicy = {
  module: 'categories',
  param: 'categoryId',
  fields: [{ name: 'image', folder: 'image', maxCount: 1, maxBytes: 5 * MB }],
  numbers: ['sortOrder'],
  booleans: ['isActive'],
  nullable: ['parent'],
};
