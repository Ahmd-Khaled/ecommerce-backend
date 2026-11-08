import { type ClientSession } from 'mongoose';
import { CategoryModel } from '../models/category/category.model';

// One database-level contention point prevents write skew across different nodes.
// Keep it separate from categories so internal metadata never changes API output.
const guardId = 'category-hierarchy';

export const categoryTransactions = {
  async write<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const guards = CategoryModel.db.collection<{
      _id: string;
      revision: number;
    }>('category_hierarchy_guards');
    // Bootstrap outside the transaction: concurrent first requests may race on _id.
    try {
      await guards.updateOne(
        { _id: guardId },
        { $setOnInsert: { revision: 0 } },
        { upsert: true, writeConcern: { w: 'majority' } },
      );
    } catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 11000))
        throw error;
    }
    return CategoryModel.db.transaction(
      async (session) => {
        // Must be the first operation, before taking the validation snapshot.
        const result = await guards.updateOne(
          { _id: guardId },
          { $inc: { revision: 1 } },
          { session },
        );
        if (result.matchedCount !== 1) throw new Error('Category hierarchy guard is missing');
        return work(session);
      },
      {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      },
    );
  },

  async read<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    return CategoryModel.db.transaction(work, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
    });
  },
};
