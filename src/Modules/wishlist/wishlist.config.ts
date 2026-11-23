export function wishlistLimits() {
  const value = process.env.WISHLIST_MAX_ITEMS === undefined ? 500 : Number(process.env.WISHLIST_MAX_ITEMS);
  if (!Number.isSafeInteger(value) || value < 1 || value > 500)
    throw new Error('WISHLIST_MAX_ITEMS must be a positive safe integer no greater than 500');
  return { maxItems: value };
}
