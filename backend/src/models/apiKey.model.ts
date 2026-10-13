import { Schema, model, type InferSchemaType } from "mongoose";

const apiKeySchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    keyHash: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    keyPrefix: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["active", "revoked"],
      required: true,
      default: "active",
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

export type ApiKeyDocument = InferSchemaType<typeof apiKeySchema>;

const ApiKeyModel = model("ApiKey", apiKeySchema);

export default ApiKeyModel;
