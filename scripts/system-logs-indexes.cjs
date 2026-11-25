// Explicit deployment step; never loads the application's development .env file.
const mongoose = require('mongoose');
const { systemLogModel } = require('../dist/DB/models/system-log/system-log.model');
async function main() {
  if (!process.env.SYSTEM_LOGS_MONGO_URI) throw Error('Set SYSTEM_LOGS_MONGO_URI');
  const connection = await mongoose.createConnection(process.env.SYSTEM_LOGS_MONGO_URI, {
    serverSelectionTimeoutMS: 5000, autoIndex: false,
  }).asPromise();
  try {
    await systemLogModel(connection).createIndexes();
    console.log('System Logs indexes provisioned. No existing indexes were removed.');
  } finally { await connection.close(); }
}
main().catch(() => { console.error('System Logs index provisioning failed. Check deployment configuration and database access.'); process.exitCode = 1; });
