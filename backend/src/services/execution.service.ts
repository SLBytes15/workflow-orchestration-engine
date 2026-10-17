import type { Types } from "mongoose";
import WorkflowModel from "../models/workflow.model";
import WorkflowExecutionModel from "../models/WorkflowExecution";

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
  findWorkflow(tenantId: Types.ObjectId, workflowId: Types.ObjectId): Promise<any>;
  createExecution(record: Record<string, unknown>): Promise<any>;
  deleteExecution(tenantId: Types.ObjectId, executionId: Types.ObjectId): Promise<unknown>;
  enqueueExecution(execution: any): Promise<boolean>;
  findExecution(tenantId: Types.ObjectId, executionId: Types.ObjectId): Promise<any>;
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
  deleteExecution(tenantId, executionId) {
    return WorkflowExecutionModel.deleteOne({ _id: executionId, tenantId }).exec();
  },
  // No queue/worker is configured yet. Never report a false success.
  async enqueueExecution() {
    return false;
  },
  findExecution(tenantId, executionId) {
    return WorkflowExecutionModel.findOne({ _id: executionId, tenantId }).lean().exec();
  },
  findHistory(tenantId, workflowId, limit, cursor) {
    const filter: Record<string, unknown> = { tenantId, workflowId };
    if (cursor) filter._id = { $lt: cursor };

    return WorkflowExecutionModel.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean()
      .exec();
  },
};

function objectId(value: string, field: string): Types.ObjectId {
  if (!/^[a-f\d]{24}$/i.test(value)) {
    throw new ExecutionServiceError(400, "VALIDATION_ERROR", `${field} must be a valid ID`);
  }
  return new (require("mongoose").Types.ObjectId)(value) as Types.ObjectId;
}

export function createExecutionService(
  dependencies: ExecutionServiceDependencies = databaseDependencies,
) {
  return {
    async startExecution(tenantId: Types.ObjectId, workflowIdValue: string) {
      const workflowId = objectId(workflowIdValue, "workflowId");
      const workflow = await dependencies.findWorkflow(tenantId, workflowId);

      if (!workflow) {
        throw new ExecutionServiceError(404, "WORKFLOW_NOT_FOUND", "Workflow not found");
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

      const accepted = await dependencies.enqueueExecution(record);
      if (!accepted) {
        await dependencies.deleteExecution(tenantId, record._id);
        throw new ExecutionServiceError(
          503,
          "EXECUTION_QUEUE_UNAVAILABLE",
          "Workflow execution is temporarily unavailable because no execution worker is configured",
        );
      }

      return record;
    },

    async getExecution(tenantId: Types.ObjectId, executionIdValue: string) {
      const executionId = objectId(executionIdValue, "executionId");
      const execution = await dependencies.findExecution(tenantId, executionId);

      if (!execution) {
        throw new ExecutionServiceError(404, "EXECUTION_NOT_FOUND", "Execution not found");
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
        throw new ExecutionServiceError(400, "VALIDATION_ERROR", "limit must be an integer from 1 to 100");
      }

      let cursor: Types.ObjectId | undefined;
      if (cursorValue !== undefined) {
        if (typeof cursorValue !== "string") {
          throw new ExecutionServiceError(400, "VALIDATION_ERROR", "cursor must be a valid execution ID");
        }
        cursor = objectId(cursorValue, "cursor");
      }

      const records = await dependencies.findHistory(tenantId, workflowId, limit, cursor);
      const hasMore = records.length > limit;
      const executions = hasMore ? records.slice(0, limit) : records;

      return {
        executions,
        pagination: {
          limit,
          hasMore,
          nextCursor: hasMore ? String(executions[executions.length - 1]._id) : null,
        },
      };
    },
  };
}
