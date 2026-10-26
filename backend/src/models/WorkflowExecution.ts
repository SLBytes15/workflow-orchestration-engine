import { Schema, model, models } from "mongoose";

type NodeResultStatus = "completed" | "failed" | "skipped";
type NodeCompensationStatus = "pending" | "running" | "completed" | "failed" | "skipped";

interface NodeCompensation {
  status: NodeCompensationStatus;
  startedAt?: Date | null;
  completedAt?: Date | null;
  error?: unknown;
}

interface NodeResult {
  nodeId: string;
  status: NodeResultStatus;
  output?: unknown;
  error?: unknown;
  compensation?: NodeCompensation;
}

const NODE_RESULT_STATUSES = new Set<string>([
  "completed",
  "failed",
  "skipped",
]);
const NODE_COMPENSATION_STATUSES = new Set<string>([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidNodeResultStatus(value: unknown): value is NodeResultStatus {
  return typeof value === "string" && NODE_RESULT_STATUSES.has(value);
}

function isValidCompensation(value: unknown): value is NodeCompensation {
  return (
    isRecord(value) &&
    typeof value.status === "string" &&
    NODE_COMPENSATION_STATUSES.has(value.status)
  );
}

function validateNodeResults(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (result) =>
        isRecord(result) &&
        typeof result.nodeId === "string" &&
        result.nodeId.trim().length > 0 &&
        isValidNodeResultStatus(result.status) &&
        (result.compensation === undefined ||
          result.compensation === null ||
          isValidCompensation(result.compensation)),
    )
  );
}

const executionCompensationSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["not_started", "running", "completed", "failed"],
      required: true,
    },
    startedAt: {
      type: Date,
      default: undefined,
    },
    completedAt: {
      type: Date,
      default: undefined,
    },
    error: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
  },
  { _id: false },
);

const nodeCompensationSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["pending", "running", "completed", "failed", "skipped"],
      required: true,
    },
    startedAt: {
      type: Date,
      default: undefined,
    },
    completedAt: {
      type: Date,
      default: undefined,
    },
    error: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
  },
  { _id: false },
);

const nodeResultSchema = new Schema<NodeResult>(
  {
    nodeId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: [...NODE_RESULT_STATUSES],
      required: true,
    },
    output: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    error: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    compensation: {
      type: nodeCompensationSchema,
      required: false,
      default: undefined,
    },
  },
  { _id: false, strict: false },
);

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
      type: [nodeResultSchema],
      default: [],
      validate: {
        validator: validateNodeResults,
        message:
          "Node results or compensation status is invalid.",
      },
    },

    compensation: {
      type: executionCompensationSchema,
      required: false,
      default: undefined,
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
  for (const [index, result] of (this.nodeResults ?? []).entries()) {
    if (result === null || typeof result !== "object" || Array.isArray(result)) {
      continue;
    }

    if (!isValidNodeResultStatus(result.status)) {
      this.invalidate(
        `nodeResults.${index}.status`,
        `Unsupported node-result status: ${result.status}`,
      );
    }

    const compensation = result.compensation;
    if (compensation != null && !isValidCompensation(compensation)) {
      this.invalidate(
        `nodeResults.${index}.compensation`,
        "Compensation metadata is invalid.",
      );
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
