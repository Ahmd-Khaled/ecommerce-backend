// Read-only rollout audit. Explicit URI prevents accidental use of application credentials.
const mongoose = require('mongoose');
const { ProductModel } = require('../dist/DB/models/product/product.model');
const { OrderModel } = require('../dist/DB/models/order/order.model');
const { storeMoney, toMinor } = require('../dist/Utils/money');
async function main() {
  if (!process.env.MONGO_AUDIT_URI) throw new Error('Set MONGO_AUDIT_URI explicitly, including the intended database');
  const currency = storeMoney();
  await mongoose.connect(process.env.MONGO_AUDIT_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  try {
    let products = 0, invalidProducts = 0;
    const examples = [];
    for await (const product of ProductModel.find().select('_id price compareAtPrice stock').lean().cursor()) {
      products++;
      try {
        toMinor(product.price);
        if (product.compareAtPrice !== undefined) toMinor(product.compareAtPrice);
        if (!Number.isSafeInteger(product.stock) || product.stock < 0) throw new Error('Invalid stock');
      } catch {
        invalidProducts++;
        if (examples.length < 20) examples.push(String(product._id));
      }
    }
    const legacyOrders = await OrderModel.countDocuments({ schemaVersion: { $ne: 2 } });
    const duplicateKeys = await OrderModel.aggregate([
      { $match: { idempotencyKey: { $type: 'string' } } },
      { $group: { _id: { user: '$user', key: '$idempotencyKey' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }, { $count: 'groups' },
    ]);
    const duplicateKeyGroups = duplicateKeys[0]?.groups ?? 0;
    console.log(JSON.stringify({ ...currency, products, invalidProducts, invalidProductExamples: examples,
      legacyOrders, duplicateKeyGroups, currencyRequiresBusinessConfirmation: true }, null, 2));
    if (invalidProducts || duplicateKeyGroups) process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
}
main().catch(() => { console.error('Order audit failed; check explicit URI, connectivity and currency configuration. No data was modified.'); process.exitCode = 1; });
