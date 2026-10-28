import { Schema, model, type Types } from "mongoose";

export interface IBusinessEvent {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  eventName: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const businessEventSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
    },
    eventName: {
      type: String,
      required: true,
      trim: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    collection: "business_events",
  },
);

businessEventSchema.index({ tenantId: 1, eventName: 1, createdAt: -1 });

const BusinessEventModel = model<IBusinessEvent>(
  "BusinessEvent",
  businessEventSchema,
);

export default BusinessEventModel;

