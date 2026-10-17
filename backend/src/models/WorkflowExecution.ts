import { Schema, model, models } from "mongoose";

const workflowExecutionSchema = new Schema(
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

    workflowVersion: {
      type: Number,
      required: true,
      min: 1,
    },

    status: {
      type: String,
      enum: ["queued", "running", "completed", "failed"],
      required: true,
      default: "queued",
    },

    graphSnapshot: {
      type: Schema.Types.Mixed,
      required: true,
    },

    currentNodeId: {
      type: String,
      default: null,
    },

    nodeResults: {
      type: [Schema.Types.Mixed],
      default: [],
    },

    error: {
      type: Schema.Types.Mixed,
      default: null,
    },

    startedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

workflowExecutionSchema.index({
  tenantId: 1,
  workflowId: 1,
  createdAt: -1,
});

workflowExecutionSchema.index({
  tenantId: 1,
  _id: 1,
});

const WorkflowExecutionModel =
  models.WorkflowExecution ??
  model("WorkflowExecution", workflowExecutionSchema);

export default WorkflowExecutionModel;
