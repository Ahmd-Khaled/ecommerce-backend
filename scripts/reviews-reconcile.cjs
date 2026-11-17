const mongoose = require('mongoose');
const { ProductModel } = require('../dist/DB/models/product/product.model');
const { ReviewModel } = require('../dist/DB/models/review/review.model');

async function main() {
  if (!process.env.MONGO_AUDIT_URI) throw new Error('Set MONGO_AUDIT_URI explicitly to the intended database');
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGO_AUDIT_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  try {
    const summaries = await ReviewModel.aggregate([
      { $match: { state: 'published' } },
      { $group: { _id: '$product', ratingsSum: { $sum: '$rating' }, ratingsCount: { $sum: 1 } } },
    ]);
    const expected = new Map(summaries.map(value => [String(value._id), value]));
    let mismatches = 0;
    for await (const product of ProductModel.find().select('_id ratingsSum ratingsCount').lean().cursor()) {
      const correct = expected.get(String(product._id)) || { ratingsSum: 0, ratingsCount: 0 };
      if ((product.ratingsSum || 0) === correct.ratingsSum && (product.ratingsCount || 0) === correct.ratingsCount) continue;
      mismatches++;
      console.log(JSON.stringify({ productId: String(product._id), stored: { ratingsSum: product.ratingsSum || 0, ratingsCount: product.ratingsCount || 0 }, expected: correct, applied: apply }));
      if (apply) await ProductModel.updateOne({ _id: product._id }, { $set: { ratingsSum: correct.ratingsSum, ratingsCount: correct.ratingsCount } }).exec();
      expected.delete(String(product._id));
    }
    for (const [productId, correct] of expected) {
      mismatches++;
      console.log(JSON.stringify({ productId, stored: { ratingsSum: 0, ratingsCount: 0 }, expected: correct, applied: apply }));
      if (apply) await ProductModel.updateOne({ _id: new mongoose.Types.ObjectId(productId) }, { $set: { ratingsSum: correct.ratingsSum, ratingsCount: correct.ratingsCount } }).exec();
    }
    console.log(JSON.stringify({ productsWithMismatches: mismatches, mode: apply ? 'apply' : 'dry-run' }));
    if (mismatches && !apply) process.exitCode = 2;
  } finally { await mongoose.disconnect(); }
}
main().catch(error => { console.error('Review reconciliation failed; verify the explicit URI and database access.'); console.error(error.message); process.exitCode = 1; });
