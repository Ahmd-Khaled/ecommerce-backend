// Read lazily: dotenv is loaded after module imports during bootstrap.
export function cartLimits() {
  const read = (key: string, fallback: number) => {
    const value = process.env[key] === undefined ? fallback : Number(process.env[key]);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${key} must be a positive safe integer`);
    return value;
  };
  return {
    maxItems: read("CART_MAX_ITEMS", 50),
    maxQuantity: read("CART_MAX_QUANTITY", 100),
  };
}
