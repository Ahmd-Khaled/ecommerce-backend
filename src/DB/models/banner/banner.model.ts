import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const bannerSchema = new Schema({
  image: { type: String, required: true },
  language: { type: String, enum: ['ar', 'en'], required: true },
  view: { type: String, enum: ['mobile', 'desktop'], required: true },
  title: { type: String, trim: true, maxlength: 150 },
  altText: { type: String, trim: true, maxlength: 300 },
  linkUrl: { type: String, maxlength: 2048 },
  sortOrder: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  isActive: { type: Boolean, default: true },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
}, { timestamps: true, optimisticConcurrency: true });
bannerSchema.pre('validate', function () {
  if (this.startsAt && this.endsAt && this.endsAt <= this.startsAt)
    this.invalidate('endsAt', 'End must be after start');
});
bannerSchema.index({ language: 1, view: 1, isActive: 1, sortOrder: 1, _id: 1 });
bannerSchema.index({ sortOrder: 1, _id: 1 });
export type Banner = InferSchemaType<typeof bannerSchema>;
export type BannerDocument = HydratedDocument<Banner>;
export const BannerModel = model('Banner', bannerSchema);
