import { model, models, Schema, type Model } from 'mongoose';

export interface IReviewSettings {
  _id: string;
  autoApproveReviews: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const schema = new Schema<IReviewSettings>(
  {
    _id: { type: String, required: true },
    autoApproveReviews: { type: Boolean, default: false, required: true },
  },
  { timestamps: true, versionKey: false },
);

export const ReviewSettingsModel =
  (models.ReviewSettings as Model<IReviewSettings> | undefined) ?? model<IReviewSettings>('ReviewSettings', schema);
