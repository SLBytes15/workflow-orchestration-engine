
import { Schema, model } from "mongoose";

const workflowSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["draft", "active", "paused"],
      required: true,
      default: "draft",
    },
    version: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
  },
  {
    timestamps: true,
  }
);

const WorkflowModel = model("Workflow", workflowSchema);

export default WorkflowModel;
