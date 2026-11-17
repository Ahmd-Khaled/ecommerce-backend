import { ReviewSettingsModel } from '../models/settings/review-settings.model';
import type { ClientSession } from 'mongoose';

const SETTINGS_ID = 'product-reviews';
export const reviewSettingsRepository = {
  async initialize() {
    await ReviewSettingsModel.updateOne(
      { _id: SETTINGS_ID },
      { $setOnInsert: { autoApproveReviews: false } },
      { upsert: true },
    ).exec();
  },
  async get(session?: ClientSession) {
    const settings = await ReviewSettingsModel.findOne({ _id: SETTINGS_ID }).session(session ?? null).lean().exec();
    return { autoApproveReviews: settings?.autoApproveReviews ?? false };
  },
  async set(autoApproveReviews: boolean) {
    const settings = await ReviewSettingsModel.findOneAndUpdate(
      { _id: SETTINGS_ID },
      { $set: { autoApproveReviews } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean().exec();
    return { autoApproveReviews: settings!.autoApproveReviews };
  },
};
