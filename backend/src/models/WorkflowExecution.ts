import { Schema, model, models } from "mongoose";

const compensationErrorSchema = new Schema(
  {
    code: { type: String, required: true },
    message: { type: String, required: true },
  },
  { _id: false },
);

const compensationSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["pending", "running", "completed", "failed"],
      required: true,
    },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    error: {
      type: compensationErrorSchema,
      default: null,
    },
  },
  { _id: false },
);

const nodeErrorSchema = new Schema(
  {
    code: { type: String, required: true },
    message: { type: String, required: true },
  },
  { _id: false },
);

const nodeResultSchema = new Schema(
  {
    nodeId: { type: String, required: true },
    status: {
      type: String,
      enum: ["completed", "failed", "skipped"],
      required: true,
    },
    output: { type: Schema.Types.Mixed },
    error: {
      type: nodeErrorSchema,
      default: undefined,
    },
    compensation: {
      type: compensationSchema,
      default: undefined,
    },
  },
  { _id: false },
);

const validateNodeResults = (nodeResults: unknown[]) => {
  const nodeStatuses = ["completed", "failed", "skipped"];
  const compensationStatuses = [
    "pending",
    "running",
    "completed",
    "failed",
  ];

  return nodeResults.every((result) => {
    if (result === null || typeof result !== "object" || Array.isArray(result)) {
      return true;
    }

    const nodeResult = result as {
      status?: unknown;
      compensation?: { status?: unknown } | null;
    };

    if (
      nodeResult.status !== undefined &&
      !nodeStatuses.includes(nodeResult.status as string)
    ) {
      return false;
    }

    if (nodeResult.compensation != null) {
      if (
        typeof nodeResult.compensation !== "object" ||
        Array.isArray(nodeResult.compensation)
      ) {
        return false;
      }

      const compensationStatus = nodeResult.compensation.status;
      if (
        compensationStatus !== undefined &&
        !compensationStatuses.includes(compensationStatus as string)
      ) {
        return false;
      }
    }

    return true;
  });
};

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
      enum: [
        "queued",
        "running",
        "completed",
        "failed",
        "compensating",
        "compensated",
        "compensation_failed",
      ],
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
      validate: {
        validator: validateNodeResults,
        message:
          "Node results or compensation status is invalid.",
      },
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
  { timestamps: true },
);

workflowExecutionSchema.pre("validate", function () {
  const nodeStatuses = ["completed", "failed", "skipped"];
  const compensationStatuses = [
    "pending",
    "running",
    "completed",
    "failed",
  ];

  for (const [index, result] of (this.nodeResults ?? []).entries()) {
    if (result === null || typeof result !== "object" || Array.isArray(result)) {
      continue;
    }

    if (
      result.status !== undefined &&
      !nodeStatuses.includes(result.status)
    ) {
      this.invalidate(
        `nodeResults.${index}.status`,
        `Unsupported node-result status: ${result.status}`,
      );
    }

    const compensation = result.compensation;
    if (compensation != null) {
      if (
        typeof compensation !== "object" ||
        Array.isArray(compensation)
      ) {
        this.invalidate(
          `nodeResults.${index}.compensation`,
          "Compensation metadata must be an object",
        );
      } else if (
        compensation.status !== undefined &&
        !compensationStatuses.includes(compensation.status)
      ) {
        this.invalidate(
          `nodeResults.${index}.compensation.status`,
          `Unsupported compensation status: ${compensation.status}`,
        );
      }
    }
  }
});

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
