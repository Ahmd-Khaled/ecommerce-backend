import { Types } from 'mongoose';
import { wishlistRepository } from '../../DB/repository/wishlist.repository';
import { productRepository } from '../../DB/repository/product.repository';
import { BadRequestException, ConflictException, NotFoundException } from '../../Utils/response/error.response';
import { wishlistLimits } from './wishlist.config';
import type { WishlistListDTO } from './wishlist.dto';

type Cursor = { addedAt: Date; id: Types.ObjectId };
function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify({ t: cursor.addedAt.toISOString(), i: cursor.id.toString() })).toString('base64url');
}
function decodeCursor(value?: string): Cursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (!parsed || typeof parsed.t !== 'string' || !Types.ObjectId.isValid(parsed.i)) throw new Error();
    const addedAt = new Date(parsed.t);
    if (!Number.isFinite(addedAt.getTime()) || addedAt.toISOString() !== parsed.t) throw new Error();
    return { addedAt, id: new Types.ObjectId(parsed.i) };
  } catch {
    throw new BadRequestException('Invalid wishlist cursor');
  }
}

class WishlistService {
  async add(user: Types.ObjectId, rawProductId: string) {
    if (!Types.ObjectId.isValid(rawProductId)) throw new BadRequestException('Invalid product ID');
    const productId = new Types.ObjectId(rawProductId);
    if (!(await productRepository.existsProduct({ _id: productId, isActive: true }))) throw new NotFoundException('Product not found');
    if (await wishlistRepository.has(user, productId)) return { isFavorited: true, added: false };
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!(await wishlistRepository.reserve(user, wishlistLimits().maxItems))) {
        if (await wishlistRepository.has(user, productId)) return { isFavorited: true, added: false };
        throw new ConflictException('Wishlist item limit reached');
      }
      try {
        const inserted = await wishlistRepository.insert(user, productId);
        if (!inserted) {
          await wishlistRepository.release(user);
          return { isFavorited: true, added: false };
        }
        return { isFavorited: true, added: true };
      } catch (error) {
        await wishlistRepository.release(user);
        if (attempt === 2) throw error;
        if (await wishlistRepository.has(user, productId)) return { isFavorited: true, added: false };
      }
    }
    throw new ConflictException('Wishlist changed concurrently; try again');
  }

  async remove(user: Types.ObjectId, rawProductId: string) {
    if (!Types.ObjectId.isValid(rawProductId)) throw new BadRequestException('Invalid product ID');
    await wishlistRepository.remove(user, new Types.ObjectId(rawProductId));
    return { isFavorited: false };
  }

  async state(user: Types.ObjectId, rawProductId: string) {
    if (!Types.ObjectId.isValid(rawProductId)) throw new BadRequestException('Invalid product ID');
    return { isFavorited: await wishlistRepository.has(user, new Types.ObjectId(rawProductId)) };
  }

  async list(user: Types.ObjectId, query: WishlistListDTO) {
    const limit = query.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('Limit must be between 1 and 100');
    let cursor = decodeCursor(query.after);
    const products: Record<string, unknown>[] = [];
    let hasNextPage = false;
    let scans = 0;
    let nextCursor: string | null = null;
    while (products.length <= limit && scans < 10) {
      const rows = await wishlistRepository.pageRows(user, cursor, Math.min(100, Math.max(limit + 1, 25)));
      if (!rows.length) break;
      const ids = rows.map((row) => row.product);
      const active = await productRepository.findProducts({ _id: { $in: ids }, isActive: true }, { limit: ids.length });
      const byId = new Map(active.map((product) => [product._id.toString(), product]));
      for (const row of rows) {
        cursor = { addedAt: row.addedAt, id: row._id };
        const product = byId.get(row.product.toString());
        if (!product) continue;
        const current = product as any;
        products.push({ _id: product._id, name: product.name, slug: product.slug, description: product.description, price: product.price, compareAtPrice: product.compareAtPrice, stock: product.stock, images: product.images, category: product.category, isActive: product.isActive, createdAt: current.createdAt, updatedAt: current.updatedAt, ratingsAverage: current.ratingsAverage, ratingsCount: product.ratingsCount, isFavorited: true, __cursor: encodeCursor(cursor) });
        if (products.length > limit) { hasNextPage = true; break; }
      }
      scans++;
      if (rows.length < Math.min(100, Math.max(limit + 1, 25))) break;
    }
    const pageProducts = products.slice(0, limit);
    hasNextPage = products.length > limit;
    nextCursor = hasNextPage ? String(pageProducts[pageProducts.length - 1]?.__cursor ?? '') || null : null;
    for (const item of pageProducts) delete item.__cursor;
    return { items: pageProducts, pagination: { limit, hasNextPage, nextCursor } };
  }
}

export const wishlistService = new WishlistService();
