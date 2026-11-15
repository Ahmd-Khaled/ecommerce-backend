import { Router } from 'express';
import { Types, type Model } from 'mongoose';
import type { IProduct } from '../../DB/models/product/product.interface';
import type { ICategory } from '../../DB/models/category/category.interface';
import { ProductModel } from '../../DB/models/product/product.model';
import { CategoryModel } from '../../DB/models/category/category.model';
import { UserModel } from '../../DB/models/user/user.model';
import { BannerModel } from '../../DB/models/banner/banner.model';
import { localStorage, safePath, keyPattern } from './local.storage';
import { NotFoundException } from '../response/error.response';
import type { StorageModule, StoredFile } from './storage.types';

export const storageService = {
  async owner(module: StorageModule, id: string): Promise<{ value: unknown } | null> {
    const _id = new Types.ObjectId(id);
    if (module === 'banners') {
      const row = await BannerModel.findById(_id).select('image').lean().exec();
      return row ? { value: row.image } : null;
    }
    if (module === 'products') {
      const row = await (ProductModel as Model<IProduct>)
        .findById(_id)
        .select('images')
        .lean()
        .exec();
      return row ? { value: row.images } : null;
    }
    if (module === 'categories') {
      const row = await (CategoryModel as Model<ICategory>)
        .findById(_id)
        .select('image')
        .lean()
        .exec();
      return row ? { value: row.image } : null;
    }
    const row = await UserModel.findById(_id).select('avatar').lean().exec();
    return row ? { value: row.avatar } : null;
  },
  async referenced(file: StoredFile): Promise<boolean> {
    // Check all modules: legacy records may share an existing URL.
    return Boolean(
      (await ProductModel.exists({ images: file.url })) ||
      (await CategoryModel.exists({ image: file.url })) ||
      (await UserModel.exists({ avatar: file.url })) ||
      (await BannerModel.exists({ image: file.url })),
    );
  },
  async visible(file: StoredFile): Promise<boolean> {
    const owner = await this.owner(file.module, file.ownerId);
    return Array.isArray(owner?.value) ? owner.value.includes(file.url) : owner?.value === file.url;
  },
};

export const mediaRouter = Router();
mediaRouter.get('/:module/:ownerId/:folder/:filename', async (req, res, next) => {
  const key = `${req.params.module}/${req.params.ownerId}/${req.params.folder}/${req.params.filename}`;
  if (!keyPattern.test(key)) throw new NotFoundException('File not found');
  let file: StoredFile;
  try {
    file = await localStorage.readMetadata(key);
  } catch {
    throw new NotFoundException('File not found');
  }
  if (!(await storageService.visible(file))) throw new NotFoundException('File not found');
  const filename = await safePath(key);
  res.set({
    'Content-Type': 'image/webp',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'no-store',
    'Content-Disposition': 'inline',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  res.sendFile(filename, { dotfiles: 'deny' }, (error) => {
    if (error && !res.headersSent) next(new NotFoundException('File not found'));
  });
});
