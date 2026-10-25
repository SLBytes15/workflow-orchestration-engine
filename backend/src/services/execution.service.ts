import type { Types } from "mongoose";
import WorkflowModel from "../models/workflow.model";
import WorkflowExecutionModel from "../models/WorkflowExecution";
import type { WorkflowGraph } from "../validators/workflow-graph.validator";
import {
  executeWorkflowGraph,
  type ActionRegistry,
  type RuntimeExecutionCheckpoint,
  type RuntimeExecutionResult,
} from "./execution.runtime";

type ExecutionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "compensating"
  | "compensated"
  | "compensation_failed";

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
};

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

export function createExecutionService(
  dependencies: ExecutionServiceDependencies = databaseDependencies,
  actions: ActionRegistry | undefined = dependencies.actions,
) {
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
  };
}
