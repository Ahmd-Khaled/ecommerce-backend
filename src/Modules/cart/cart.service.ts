import { Error as MongooseError, Types } from "mongoose";
import { cartRepository } from "../../DB/repository/cart.repository";
import { productRepository } from "../../DB/repository/product.repository";
import type { CartDocument } from "../../DB/models/cart/cart.interface";
import type { AddCartItemDTO, AdjustCartItemDTO, UpdateCartItemDTO } from "./cart.dto";
import { cartLimits } from "./cart.config";
import { BadRequestException, ConflictException, NotFoundException } from "../../Utils/response/error.response";

class CartService {
  private validateQuantity(quantity: number) {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > cartLimits().maxQuantity) {
      throw new BadRequestException("Quantity must be a positive integer within the cart limit");
    }
  }

  // Each save is a single atomic update conditional on __v. Re-read and
  // re-validate on conflict; never retry a stale document or an ambiguous write.
  private async mutate(userId: Types.ObjectId, change: (cart: CartDocument) => Promise<void>, create = false) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cart = await cartRepository.findCartByUser(userId) ??
        (create ? await cartRepository.createCart(userId) : null);
      if (!cart) throw new NotFoundException("Cart not found");
      await change(cart);
      try {
        await cart.save();
      } catch (error) {
        if (!(error instanceof MongooseError.VersionError)) throw error;
        continue;
      }
      return this.buildCartResponse(cart);
    }
    throw new ConflictException("Cart changed concurrently; refresh and try again");
  }

  async getCart(userId: Types.ObjectId) {
    const cart = await cartRepository.findCartByUser(userId);
    return cart ? this.buildCartResponse(cart) : { items: [], totalItems: 0, subtotal: 0, version: 0 };
  }

  async addCartItem(userId: Types.ObjectId, data: AddCartItemDTO) {
    const quantity = data.quantity ?? 1;
    this.validateQuantity(quantity);
    return this.mutate(userId, async cart => {
      const product = await this.getAvailableProduct(data.productId);
      const item = cart.items.find(item => item.product.equals(product._id));
      const next = (item?.quantity ?? 0) + quantity;
      this.validateQuantity(next);
      this.validateStock(product.stock, next);
      if (item) item.quantity = next;
      else {
        if (cart.items.length >= cartLimits().maxItems) throw new BadRequestException("Cart item limit reached");
        cart.items.push({ product: product._id, quantity });
      }
    }, true);
  }

  async increaseCartItem(userId: Types.ObjectId, productId: string, data: AdjustCartItemDTO = { quantity: 1 }) {
    return this.adjustCartItem(userId, productId, data.quantity ?? 1, false);
  }

  async decreaseCartItem(userId: Types.ObjectId, productId: string, data: AdjustCartItemDTO = { quantity: 1 }) {
    return this.adjustCartItem(userId, productId, data.quantity ?? 1, true);
  }

  private async adjustCartItem(userId: Types.ObjectId, productId: string, quantity: number, decrease: boolean) {
    this.validateQuantity(quantity);
    return this.mutate(userId, async cart => {
      const item = this.findItem(cart, productId);
      if (decrease && item.quantity === 1) {
        cart.items.splice(cart.items.indexOf(item), 1);
        return;
      }
      const next = item.quantity + (decrease ? -quantity : quantity);
      if (next < 1) throw new BadRequestException("Quantity must be at least 1");
      // Reductions and removals remain possible for unavailable products.
      if (!decrease) {
        this.validateQuantity(next);
        const product = await this.getAvailableProduct(productId);
        this.validateStock(product.stock, next);
      }
      item.quantity = next;
    });
  }

  async updateCartItem(userId: Types.ObjectId, productId: string, data: UpdateCartItemDTO) {
    this.validateQuantity(data.quantity);
    return this.mutate(userId, async cart => {
      const item = this.findItem(cart, productId);
      if (data.quantity >= item.quantity) {
        const product = await this.getAvailableProduct(productId);
        this.validateStock(product.stock, data.quantity);
      }
      item.quantity = data.quantity;
    });
  }

  async removeCartItem(userId: Types.ObjectId, productId: string) {
    return this.mutate(userId, async cart => {
      const item = this.findItem(cart, productId);
      cart.items.splice(cart.items.indexOf(item), 1);
    });
  }

  async clearCart(userId: Types.ObjectId) {
    return this.mutate(userId, async cart => { cart.items = []; });
  }

  private findItem(cart: CartDocument, productId: string) {
    if (!Types.ObjectId.isValid(productId)) throw new BadRequestException("Invalid product ID");
    const item = cart.items.find(item => item.product.equals(productId));
    if (!item) throw new NotFoundException("Product not found in cart");
    return item;
  }

  private async getAvailableProduct(productId: string) {
    if (!Types.ObjectId.isValid(productId)) throw new BadRequestException("Invalid product ID");
    const product = await productRepository.findProductById(new Types.ObjectId(productId));
    if (!product || !product.isActive) throw new NotFoundException("Product not found");
    return product;
  }

  private validateStock(stock: number, quantity: number) {
    if (stock <= 0) throw new BadRequestException("Product is out of stock");
    if (quantity > stock) throw new BadRequestException(`Only ${stock} item(s) available in stock`);
  }

  private async buildCartResponse(cart: CartDocument) {
    const items = await Promise.all(cart.items.map(async item => {
      const product = await productRepository.findProductById(item.product);
      if (!product || !product.isActive) {
        return { product: { _id: item.product }, quantity: item.quantity, available: false, subtotal: 0 };
      }
      return {
        product: { _id: product._id, name: product.name, slug: product.slug, price: product.price,
          images: product.images, stock: product.stock, isActive: product.isActive },
        quantity: item.quantity, available: product.stock >= item.quantity,
        subtotal: product.price * item.quantity,
      };
    }));
    return {
      items,
      totalItems: items.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: items.reduce((sum, item) => sum + item.subtotal, 0),
      version: cart.__v,
    };
  }
}

export const cartService = new CartService();
