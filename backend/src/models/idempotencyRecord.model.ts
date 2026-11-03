import { Schema, model, models, type InferSchemaType } from "mongoose";

const idempotencyRecordSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    workflowId: {
      type: Schema.Types.ObjectId,
      ref: "Workflow",
      required: true,
      index: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
    },
    payloadHash: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["in_flight", "completed"],
      required: true,
      default: "in_flight",
    },
    executionId: {
      type: Schema.Types.ObjectId,
      ref: "WorkflowExecution",
      default: null,
    },
    reservationToken: {
      type: String,
      default: null,
    },
    responseBody: {
      type: Schema.Types.Mixed,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// 1. Logical unique compound index across tenantId, workflowId, and idempotency key
idempotencyRecordSchema.index(
  { tenantId: 1, workflowId: 1, key: 1 },
  { unique: true },
);

// 2. TTL index for automatic background MongoDB expiration
idempotencyRecordSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 },
);

export type IdempotencyRecordDocument = InferSchemaType<
  typeof idempotencyRecordSchema
>;

const IdempotencyRecordModel =
  models.IdempotencyRecord ??
  model("IdempotencyRecord", idempotencyRecordSchema);

export default IdempotencyRecordModel;

