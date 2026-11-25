// Read-only query analysis against the configured log database; never prints records or credentials.
const mongoose = require('mongoose');
const { systemLogModel } = require('../dist/DB/models/system-log/system-log.model');
async function main() {
  if (!process.env.SYSTEM_LOGS_MONGO_URI) throw Error('Set SYSTEM_LOGS_MONGO_URI');
  const connection = await mongoose.createConnection(process.env.SYSTEM_LOGS_MONGO_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false }).asPromise();
  try {
    const model = systemLogModel(connection);
    const now = new Date(); const from = new Date(now.getTime() - 86400000);
    const base = { occurredAt: { $gte: from, $lt: now }, expiresAt: { $gt: now }, ingestedAt: { $lte: now } };
    const sample = await model.findOne(base).sort({ occurredAt: -1, _id: -1 }).lean().maxTimeMS(2000);
    const queries = { recent: base, errors: { ...base, 'http.statusCode': { $gte: 500, $lt: 600 } },
      slow: { ...base, 'http.durationMs': { $gte: 1000 } }, empty: { ...base, requestId: '00000000-0000-4000-8000-000000000000' } };
    if (sample) {
      queries.requestId = { ...base, requestId: sample.requestId };
      queries.route = { ...base, 'http.route': sample.http.route };
      queries.cursor = { ...base, $or: [{ occurredAt: { $lt: sample.occurredAt } }, { occurredAt: sample.occurredAt, _id: { $lt: sample._id } }] };
    }
    for (const [name, filter] of Object.entries(queries)) {
      const plan = await model.find(filter).sort({ occurredAt: -1, _id: -1 }).limit(26).maxTimeMS(2000).explain('executionStats');
      const stats = plan.executionStats;
      console.log(JSON.stringify({ query: name, returned: stats.nReturned, keysExamined: stats.totalKeysExamined,
        documentsExamined: stats.totalDocsExamined, executionTimeMs: stats.executionTimeMillis,
        collectionScan: JSON.stringify(plan.queryPlanner.winningPlan).includes('COLLSCAN'),
        blockingSort: /"stage":"SORT"/.test(JSON.stringify(plan.queryPlanner.winningPlan)) }));
    }
  } finally { await connection.close(); }
}
main().catch(() => { console.error('System Logs query analysis failed; inspect database availability, indexes and query time budget.'); process.exitCode = 1; });
