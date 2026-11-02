import type { PipelineStage, Types } from "mongoose";
import WorkflowModel from "../models/workflow.model";
import WorkflowExecutionModel from "../models/WorkflowExecution";
import type { WorkflowGraph } from "../validators/workflow-graph.validator";
import {
  executeWorkflowGraph,
  type ActionRegistry,
  type RuntimeExecutionCheckpoint,
  type RuntimeExecutionResult,
} from "./execution.runtime";
import type { PersistedExecutionLike } from "./executionWebSocket";

type ExecutionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "compensating"
  | "compensated"
  | "compensation_failed";

export type ExecutionSummary = {
  total: number;
  completed: number;
  failed: number;
  compensated: number;
  compensationFailed: number;
  unsuccessful: number;
  running: number;
  compensating: number;
  queued: number;
  successRate: number;
  failureRate: number;
  avgDurationMs: number | null;
};

export type ExecutionSummaryFilter = {
  workflowId: string | null;
  from: string | null;
  to: string | null;
};

export type ExecutionSummaryResult = {
  summary: ExecutionSummary;
  filter: ExecutionSummaryFilter;
};

export type ExecutionSummaryOptions = {
  workflowId?: unknown;
  from?: unknown;
  to?: unknown;
};

type ExecutionUpdate = {
  status: ExecutionStatus;
  currentNodeId?: string | null;
  nodeResults?: RuntimeExecutionResult["nodeResults"];
  error?: RuntimeExecutionResult["error"] | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
};

export function buildExecutionUpdateFilter(
  tenantId: Types.ObjectId,
  executionId: Types.ObjectId,
  expectedStatus: ExecutionStatus,
  expectedNodeResults?: RuntimeExecutionResult["nodeResults"],
): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    _id: executionId,
    tenantId,
    status: expectedStatus,
  };
  if (expectedNodeResults !== undefined) {
    filter.nodeResults = expectedNodeResults;
  }
  return filter;
}

export class ExecutionServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ExecutionServiceError";
  }
}

export interface ExecutionServiceDependencies {
  actions?: ActionRegistry;

  findWorkflow(
    tenantId: Types.ObjectId,
    workflowId: Types.ObjectId,
  ): Promise<any>;

  createExecution(record: Record<string, unknown>): Promise<any>;

  updateExecution(
    tenantId: Types.ObjectId,
    executionId: Types.ObjectId,
    expectedStatus: ExecutionStatus,
    expectedNodeResults: RuntimeExecutionResult["nodeResults"] | undefined,
    update: ExecutionUpdate,
  ): Promise<any>;

  findExecution(
    tenantId: Types.ObjectId,
    executionId: Types.ObjectId,
  ): Promise<any>;

  findHistory(
    tenantId: Types.ObjectId,
    workflowId: Types.ObjectId,
    limit: number,
    cursor?: Types.ObjectId,
  ): Promise<any[]>;

  findGlobalHistory?(
    filter: Record<string, unknown>,
    limit: number,
  ): Promise<any[]>;

  aggregateExecutions?(
    pipeline: PipelineStage[],
  ): Promise<any[]>;
}

const databaseDependencies: ExecutionServiceDependencies = {
  findWorkflow(tenantId, workflowId) {
    return WorkflowModel.findOne({ _id: workflowId, tenantId }).lean().exec();
  },

  createExecution(record) {
    return WorkflowExecutionModel.create(record);
  },

  updateExecution(
    tenantId,
    executionId,
    expectedStatus,
    expectedNodeResults,
    update,
  ) {
    return WorkflowExecutionModel.findOneAndUpdate(
      buildExecutionUpdateFilter(
        tenantId,
        executionId,
        expectedStatus,
        expectedNodeResults,
      ),
      { $set: update },
      { new: true, runValidators: true },
    )
      .lean()
      .exec();
  },

  findExecution(tenantId, executionId) {
    return WorkflowExecutionModel.findOne({ _id: executionId, tenantId })
      .lean()
      .exec();
  },

  findHistory(tenantId, workflowId, limit, cursor) {
    const filter: Record<string, unknown> = { tenantId, workflowId };

    if (cursor) {
      filter._id = { $lt: cursor };
    }

    return WorkflowExecutionModel.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean()
      .exec();
  },

  findGlobalHistory(filter, limit) {
    return WorkflowExecutionModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean()
      .exec();
  },

  aggregateExecutions(pipeline: PipelineStage[]) {
    return WorkflowExecutionModel.aggregate(pipeline).exec();
  },
};

const VALID_EXECUTION_STATUSES = new Set<string>([
  "queued",
  "running",
  "completed",
  "failed",
  "compensating",
  "compensated",
  "compensation_failed",
]);

export interface GlobalExecutionQueryOptions {
  workflowId?: unknown;
  status?: unknown;
  from?: unknown;
  to?: unknown;
  executionId?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

export function encodeGlobalCursor(
  createdAt: Date | string,
  id: Types.ObjectId | string,
): string {
  const dateObj = createdAt instanceof Date ? createdAt : new Date(createdAt);
  return Buffer.from(
    JSON.stringify({
      createdAt: dateObj.toISOString(),
      id: String(id),
    }),
    "utf8",
  ).toString("base64url");
}

export function decodeGlobalCursor(cursorValue: unknown): {
  createdAt: Date;
  id: Types.ObjectId;
} {
  if (typeof cursorValue !== "string" || !cursorValue.trim()) {
    throw new ExecutionServiceError(
      400,
      "VALIDATION_ERROR",
      "cursor must be a valid execution cursor",
    );
  }

  let parsed: unknown;
  try {
    const raw = Buffer.from(cursorValue, "base64url").toString("utf8");
    parsed = JSON.parse(raw);
  } catch {
    throw new ExecutionServiceError(
      400,
      "VALIDATION_ERROR",
      "cursor must be a valid execution cursor",
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new ExecutionServiceError(
      400,
      "VALIDATION_ERROR",
      "cursor must be a valid execution cursor",
    );
  }

  const { createdAt, id } = parsed as { createdAt?: unknown; id?: unknown };

  if (
    typeof createdAt !== "string" ||
    !createdAt.trim() ||
    Number.isNaN(Date.parse(createdAt))
  ) {
    throw new ExecutionServiceError(
      400,
      "VALIDATION_ERROR",
      "cursor contains an invalid timestamp",
    );
  }

  if (typeof id !== "string" || !/^[a-f\d]{24}$/i.test(id)) {
    throw new ExecutionServiceError(
      400,
      "VALIDATION_ERROR",
      "cursor contains an invalid execution ID",
    );
  }

  return {
    createdAt: new Date(createdAt),
    id: objectId(id, "cursor ID"),
  };
}

function objectId(value: string, field: string): Types.ObjectId {
  if (!/^[a-f\d]{24}$/i.test(value)) {
    throw new ExecutionServiceError(
      400,
      "VALIDATION_ERROR",
      `${field} must be a valid ID`,
    );
  }

  return new (require("mongoose").Types.ObjectId)(value) as Types.ObjectId;
}

export type ExecutionNotifier = (execution: PersistedExecutionLike) => void;

const defaultNotifier: ExecutionNotifier = (execution) => {
  try {
    const {
      executionEventHub,
      publishPersistedExecution,
    } = require("./executionWebSocket");
    publishPersistedExecution(executionEventHub, execution);
  } catch {
    // Best-effort live updates: safely ignored if WebSocket infrastructure is unavailable
  }
};

export function createExecutionService(
  dependencies: ExecutionServiceDependencies = databaseDependencies,
  actions: ActionRegistry | undefined = dependencies.actions,
  notify: ExecutionNotifier = defaultNotifier,
) {
  // Live updates are best effort: a notification must never fail or roll back
  // the execution it describes.
  const safeNotify = (execution: PersistedExecutionLike | null | undefined) => {
    if (!execution) {
      return;
    }

    try {
      notify(execution);
    } catch {
      // Ignored on purpose: persistence already succeeded.
    }
  };

  return {
    async startExecution(
      tenantId: Types.ObjectId,
      workflowIdValue: string,
      input: Record<string, unknown> = {},
    ) {
      const workflowId = objectId(workflowIdValue, "workflowId");
      const workflow = await dependencies.findWorkflow(tenantId, workflowId);

      if (!workflow) {
        throw new ExecutionServiceError(
          404,
          "WORKFLOW_NOT_FOUND",
          "Workflow not found",
        );
      }

      const record = await dependencies.createExecution({
        tenantId,
        workflowId,
        workflowVersion: workflow.version,
        status: "queued",
        graphSnapshot: workflow.graph,
        currentNodeId: null,
        nodeResults: [],
        error: null,
        startedAt: null,
        completedAt: null,
      });

      const executionId = record._id as Types.ObjectId;
      const startedAt = new Date();

      const runningExecution = await dependencies.updateExecution(
        tenantId,
        executionId,
        "queued",
        [],
        {
          status: "running",
          startedAt,
          error: null,
        },
      );

      if (!runningExecution) {
        throw new ExecutionServiceError(
          500,
          "EXECUTION_STATE_UPDATE_FAILED",
          "Unable to start workflow execution.",
        );
      }

      safeNotify(runningExecution);

      let persistedStatus: ExecutionStatus = "running";
      let persistedNodeResults: RuntimeExecutionResult["nodeResults"] = [];
      const getPersistedStatus = (): ExecutionStatus => persistedStatus;
      const persistCheckpoint = async (
        checkpoint: RuntimeExecutionCheckpoint,
      ): Promise<void> => {
        let saved;
        try {
          saved = await dependencies.updateExecution(
            tenantId,
            executionId,
            persistedStatus,
            persistedNodeResults,
            {
              status: checkpoint.status,
              nodeResults: checkpoint.nodeResults,
              error: checkpoint.error,
            },
          );
        } catch {
          throw new ExecutionServiceError(
            500,
            "COMPENSATION_CHECKPOINT_FAILED",
            checkpoint.stage === "terminal"
              ? "A compensation handler may have run, but its terminal checkpoint could not be confirmed. Do not assume it succeeded; compensation will not be replayed automatically."
              : "Unable to persist the compensation checkpoint. No automatic compensation replay will be attempted.",
          );
        }
        if (!saved) {
          throw new ExecutionServiceError(
            500,
            "COMPENSATION_CHECKPOINT_FAILED",
            checkpoint.stage === "terminal"
              ? "A compensation handler may have run, but its terminal checkpoint could not be confirmed. Do not assume it succeeded; compensation will not be replayed automatically."
              : "Unable to persist the compensation checkpoint. No automatic compensation replay will be attempted.",
          );
        }
        if (
          saved.status !== checkpoint.status ||
          !Array.isArray(saved.nodeResults)
        ) {
          throw new ExecutionServiceError(
            500,
            "COMPENSATION_CHECKPOINT_FAILED",
            checkpoint.stage === "terminal"
              ? "A compensation handler may have run, but its terminal checkpoint could not be confirmed. Do not assume it succeeded; compensation will not be replayed automatically."
              : "The compensation checkpoint response did not confirm the persisted state. No automatic replay will be attempted.",
          );
        }
        persistedStatus = saved.status as ExecutionStatus;
        persistedNodeResults =
          saved.nodeResults as RuntimeExecutionResult["nodeResults"];
        safeNotify(saved);
      };

      let result: RuntimeExecutionResult;
      try {
        result = await executeWorkflowGraph(
          runningExecution.graphSnapshot as WorkflowGraph,
          input,
          actions,
          {
            executionId: String(executionId),
            workflowId: String(workflowId),
            tenantId: String(tenantId),
          },
          persistCheckpoint,
        );
      } catch (error) {
        if (error instanceof ExecutionServiceError) {
          throw error;
        }
        if (getPersistedStatus() === "compensating") {
          throw new ExecutionServiceError(
            500,
            "COMPENSATION_RUNTIME_FAILED",
            "Compensation stopped unexpectedly after entering its persisted lifecycle. A handler may have run; no terminal result was fabricated and compensation will not be replayed automatically.",
          );
        }
        result = {
          status: "failed",
          nodeResults: persistedNodeResults,
          error: {
            code: "RUNTIME_FAILED",
            message: "Workflow execution failed unexpectedly.",
          },
        };
      }

      const terminalUpdate: ExecutionUpdate = {
        status: result.status,
        nodeResults: result.nodeResults,
        error: result.error ?? null,
        completedAt: new Date(),
      };

      let finalExecution;
      try {
        finalExecution = await dependencies.updateExecution(
          tenantId,
          executionId,
          persistedStatus,
          persistedNodeResults,
          terminalUpdate,
        );
      } catch {
        throw new ExecutionServiceError(
          500,
          "EXECUTION_RESULT_PERSISTENCE_FAILED",
          getPersistedStatus() === "compensating"
            ? "Compensation checkpoints were persisted, but the terminal execution state could not be confirmed. Do not assume a terminal status; compensation will not be replayed automatically."
            : "Unable to persist the workflow execution result.",
        );
      }

      if (!finalExecution) {
        throw new ExecutionServiceError(
          500,
          "EXECUTION_RESULT_PERSISTENCE_FAILED",
          getPersistedStatus() === "compensating"
            ? "Compensation checkpoints were persisted, but the terminal execution state could not be confirmed. Do not assume a terminal status; compensation will not be replayed automatically."
            : "Unable to persist the workflow execution result.",
        );
      }

      safeNotify(finalExecution);

      return finalExecution;
    },

    async getExecution(tenantId: Types.ObjectId, executionIdValue: string) {
      const executionId = objectId(executionIdValue, "executionId");
      const execution = await dependencies.findExecution(tenantId, executionId);

      if (!execution) {
        throw new ExecutionServiceError(
          404,
          "EXECUTION_NOT_FOUND",
          "Execution not found",
        );
      }

      return execution;
    },

    async listExecutions(
      tenantId: Types.ObjectId,
      workflowIdValue: string,
      limitValue: unknown,
      cursorValue: unknown,
    ) {
      const workflowId = objectId(workflowIdValue, "workflowId");
      const limit = limitValue === undefined ? 20 : Number(limitValue);

      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new ExecutionServiceError(
          400,
          "VALIDATION_ERROR",
          "limit must be an integer from 1 to 100",
        );
      }

      let cursor: Types.ObjectId | undefined;

      if (cursorValue !== undefined) {
        if (typeof cursorValue !== "string") {
          throw new ExecutionServiceError(
            400,
            "VALIDATION_ERROR",
            "cursor must be a valid execution ID",
          );
        }

        cursor = objectId(cursorValue, "cursor");
      }

      const records = await dependencies.findHistory(
        tenantId,
        workflowId,
        limit,
        cursor,
      );

      const hasMore = records.length > limit;
      const executions = hasMore ? records.slice(0, limit) : records;

      return {
        executions,
        pagination: {
          limit,
          hasMore,
          nextCursor: hasMore
            ? String(executions[executions.length - 1]._id)
            : null,
        },
      };
    },

    async listGlobalExecutions(
      tenantId: Types.ObjectId,
      options: GlobalExecutionQueryOptions = {},
    ) {
      const limit = options.limit === undefined ? 20 : Number(options.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new ExecutionServiceError(
          400,
          "VALIDATION_ERROR",
          "limit must be an integer from 1 to 100",
        );
      }

      let workflowId: Types.ObjectId | undefined;
      if (options.workflowId !== undefined && options.workflowId !== "") {
        if (
          typeof options.workflowId !== "string" ||
          !/^[a-f\d]{24}$/i.test(options.workflowId)
        ) {
          throw new ExecutionServiceError(
            400,
            "VALIDATION_ERROR",
            "workflowId must be a valid ID",
          );
        }
        workflowId = objectId(options.workflowId, "workflowId");
      }

      let executionId: Types.ObjectId | undefined;
      if (options.executionId !== undefined && options.executionId !== "") {
        if (
          typeof options.executionId !== "string" ||
          !/^[a-f\d]{24}$/i.test(options.executionId)
        ) {
          throw new ExecutionServiceError(
            400,
            "VALIDATION_ERROR",
            "executionId must be a valid ID",
          );
        }
        executionId = objectId(options.executionId, "executionId");
      }

      let status: ExecutionStatus | undefined;
      if (options.status !== undefined && options.status !== "") {
        if (
          typeof options.status !== "string" ||
          !VALID_EXECUTION_STATUSES.has(options.status)
        ) {
          throw new ExecutionServiceError(
            400,
            "VALIDATION_ERROR",
            "Invalid execution status",
          );
        }
        status = options.status as ExecutionStatus;
      }

      let fromDate: Date | undefined;
      if (options.from !== undefined && options.from !== "") {
        if (
          typeof options.from !== "string" ||
          !options.from.trim() ||
          Number.isNaN(Date.parse(options.from))
        ) {
          throw new ExecutionServiceError(
            400,
            "VALIDATION_ERROR",
            "from must be a valid ISO date string",
          );
        }
        fromDate = new Date(options.from);
      }

      let toDate: Date | undefined;
      if (options.to !== undefined && options.to !== "") {
        if (
          typeof options.to !== "string" ||
          !options.to.trim() ||
          Number.isNaN(Date.parse(options.to))
        ) {
          throw new ExecutionServiceError(
            400,
            "VALIDATION_ERROR",
            "to must be a valid ISO date string",
          );
        }
        toDate = new Date(options.to);
      }

      if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
        throw new ExecutionServiceError(
          400,
          "VALIDATION_ERROR",
          "from date must be before or equal to to date",
        );
      }

      let cursor: { createdAt: Date; id: Types.ObjectId } | undefined;
      if (options.cursor !== undefined && options.cursor !== "") {
        cursor = decodeGlobalCursor(options.cursor);
      }

      const baseConditions: Record<string, unknown>[] = [{ tenantId }];

      if (workflowId) {
        baseConditions.push({ workflowId });
      }

      if (executionId) {
        baseConditions.push({ _id: executionId });
      }

      if (status) {
        baseConditions.push({ status });
      }

      if (fromDate || toDate) {
        const dateFilter: Record<string, unknown> = {};
        if (fromDate) dateFilter.$gte = fromDate;
        if (toDate) dateFilter.$lte = toDate;
        baseConditions.push({ createdAt: dateFilter });
      }

      if (cursor) {
        baseConditions.push({
          $or: [
            { createdAt: { $lt: cursor.createdAt } },
            {
              createdAt: cursor.createdAt,
              _id: { $lt: cursor.id },
            },
          ],
        });
      }

      const filter =
        baseConditions.length === 1
          ? baseConditions[0]
          : { $and: baseConditions };

      const findGlobalHistory =
        dependencies.findGlobalHistory ??
        databaseDependencies.findGlobalHistory ??
        ((f: Record<string, unknown>, l: number) =>
          WorkflowExecutionModel.find(f)
            .sort({ createdAt: -1, _id: -1 })
            .limit(l + 1)
            .lean()
            .exec());

      const records = await findGlobalHistory(filter, limit);

      const hasMore = records.length > limit;
      const executions = hasMore ? records.slice(0, limit) : records;

      const nextCursor = hasMore
        ? encodeGlobalCursor(
            new Date(executions[executions.length - 1].createdAt),
            executions[executions.length - 1]._id,
          )
        : null;

      return {
        executions,
        pagination: {
          limit,
          hasMore,
          nextCursor,
        },
      };
    },

    async getExecutionSummary(
      tenantId: Types.ObjectId,
      options: ExecutionSummaryOptions = {},
    ): Promise<ExecutionSummaryResult> {
      let workflowId: Types.ObjectId | undefined;
      let workflowIdStr: string | null = null;
      if (options.workflowId !== undefined && options.workflowId !== "") {
        if (
          typeof options.workflowId !== "string" ||
          !/^[a-f\d]{24}$/i.test(options.workflowId)
        ) {
          throw new ExecutionServiceError(
            400,
            "VALIDATION_ERROR",
            "workflowId must be a valid ID",
          );
        }
        workflowId = objectId(options.workflowId, "workflowId");
        workflowIdStr = options.workflowId;
      }

      let fromDate: Date | undefined;
      let fromStr: string | null = null;
      if (options.from !== undefined && options.from !== "") {
        if (
          typeof options.from !== "string" ||
          !options.from.trim() ||
          Number.isNaN(Date.parse(options.from))
        ) {
          throw new ExecutionServiceError(
            400,
            "VALIDATION_ERROR",
            "from must be a valid ISO date string",
          );
        }
        fromDate = new Date(options.from);
        fromStr = options.from;
      }

      let toDate: Date | undefined;
      let toStr: string | null = null;
      if (options.to !== undefined && options.to !== "") {
        if (
          typeof options.to !== "string" ||
          !options.to.trim() ||
          Number.isNaN(Date.parse(options.to))
        ) {
          throw new ExecutionServiceError(
            400,
            "VALIDATION_ERROR",
            "to must be a valid ISO date string",
          );
        }
        toDate = new Date(options.to);
        toStr = options.to;
      }

      if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
        throw new ExecutionServiceError(
          400,
          "VALIDATION_ERROR",
          "from date must be before or equal to to date",
        );
      }

      const matchConditions: Record<string, unknown>[] = [{ tenantId }];

      if (workflowId) {
        matchConditions.push({ workflowId });
      }

      if (fromDate || toDate) {
        const dateFilter: Record<string, unknown> = {};
        if (fromDate) dateFilter.$gte = fromDate;
        if (toDate) dateFilter.$lte = toDate;
        matchConditions.push({ createdAt: dateFilter });
      }

      const matchFilter =
        matchConditions.length === 1
          ? matchConditions[0]
          : { $and: matchConditions };

      const aggregateExecutions =
        dependencies.aggregateExecutions ??
        databaseDependencies.aggregateExecutions ??
        ((p: PipelineStage[]) =>
          WorkflowExecutionModel.aggregate(p).exec());

      const pipeline: PipelineStage[] = [
        { $match: matchFilter },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            queued: {
              $sum: { $cond: [{ $eq: ["$status", "queued"] }, 1, 0] },
            },
            running: {
              $sum: { $cond: [{ $eq: ["$status", "running"] }, 1, 0] },
            },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
            },
            failed: {
              $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
            },
            compensating: {
              $sum: { $cond: [{ $eq: ["$status", "compensating"] }, 1, 0] },
            },
            compensated: {
              $sum: { $cond: [{ $eq: ["$status", "compensated"] }, 1, 0] },
            },
            compensation_failed: {
              $sum: { $cond: [{ $eq: ["$status", "compensation_failed"] }, 1, 0] },
            },
            totalDurationMs: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$startedAt", null] },
                      { $ne: ["$completedAt", null] },
                      { $gte: ["$completedAt", "$startedAt"] },
                    ],
                  },
                  { $subtract: ["$completedAt", "$startedAt"] },
                  0,
                ],
              },
            },
            durationCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$startedAt", null] },
                      { $ne: ["$completedAt", null] },
                      { $gte: ["$completedAt", "$startedAt"] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ];

      const [raw] = await aggregateExecutions(pipeline);

      if (!raw) {
        return {
          summary: {
            total: 0,
            completed: 0,
            failed: 0,
            compensated: 0,
            compensationFailed: 0,
            unsuccessful: 0,
            running: 0,
            compensating: 0,
            queued: 0,
            successRate: 0,
            failureRate: 0,
            avgDurationMs: null,
          },
          filter: {
            workflowId: workflowIdStr,
            from: fromStr,
            to: toStr,
          },
        };
      }

      const total = Number(raw.total ?? 0);
      const queued = Number(raw.queued ?? 0);
      const running = Number(raw.running ?? 0);
      const completed = Number(raw.completed ?? 0);
      const failed = Number(raw.failed ?? 0);
      const compensating = Number(raw.compensating ?? 0);
      const compensated = Number(raw.compensated ?? 0);
      const compensationFailed = Number(raw.compensation_failed ?? 0);

      const unsuccessful = failed + compensated + compensationFailed;
      const terminalCount = completed + unsuccessful;

      const successRate =
        terminalCount > 0
          ? Number(((completed / terminalCount) * 100).toFixed(2))
          : 0;

      const failureRate =
        terminalCount > 0
          ? Number(((unsuccessful / terminalCount) * 100).toFixed(2))
          : 0;

      const avgDurationMs =
        raw.durationCount > 0
          ? Math.round(Number(raw.totalDurationMs) / Number(raw.durationCount))
          : null;

      return {
        summary: {
          total,
          completed,
          failed,
          compensated,
          compensationFailed,
          unsuccessful,
          running,
          compensating,
          queued,
          successRate,
          failureRate,
          avgDurationMs,
        },
        filter: {
          workflowId: workflowIdStr,
          from: fromStr,
          to: toStr,
        },
      };
    },
  };
}
