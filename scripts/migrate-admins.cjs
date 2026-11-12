// Dry run by default. Apply during a maintenance window after a database backup.
require('dotenv').config({ path: './config/.env.dev' });
const mongoose = require('mongoose');
const { AdminModel } = require('../dist/DB/models/admin/admin.model');
async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI);
  await AdminModel.init();
  const users = mongoose.connection.collection('users');
  const filter = { role: { $in: ['admin', 'super-admin'] } };
  const count = await users.countDocuments(filter);
  console.log(`${count} legacy administrator(s) found.`);
  if (!process.argv.includes('--apply')) { console.log('Dry run. Pass --apply to migrate.'); return; }
  for await (const candidate of users.find(filter)) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const user = await users.findOne({ _id: candidate._id, ...filter }, { session });
        if (!user) return;
        if (!user.password) throw new Error('Legacy administrator has no password; provision credentials before migration');
        const conflict = await AdminModel.collection.findOne({ $or: [{ _id: user._id }, { email: user.email.toLowerCase().trim() }] }, { session });
        if (conflict) throw new Error('Administrator identity collision; reconcile before migrating');
        // Insert the existing hash directly; model save hooks would hash it again.
        await AdminModel.collection.insertOne({ _id: user._id, firstName: user.firstName, lastName: user.lastName,
          email: user.email.toLowerCase().trim(), password: user.password, role: user.role,
          tokenVersion: (user.tokenVersion ?? 0) + 1, createdAt: user.createdAt ?? new Date(), updatedAt: new Date(),
          ...(user.freezedAt ? { freezedAt: user.freezedAt } : {}) }, { session });
        // Keep a disabled historical customer reference for orders/carts; remove credentials.
        await users.updateOne({ _id: user._id, ...filter }, {
          $set: { role: 'guest', deletedAt: new Date(), freezedAt: new Date() }, $inc: { tokenVersion: 1 },
          $unset: { password: '', googleSub: '', confirmEmailOTP: '', resetPasswordOTP: '' },
        }, { session });
      });
    } finally { await session.endSession(); }
  }
  console.log('Migration complete. Administrator IDs and catalog references are preserved.');
}
main().catch(error => { console.error('Migration failed: ' + error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
