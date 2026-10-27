import { Types } from "mongoose";
import WorkflowModel from "../models/workflow.model";
import type { CreateWorkflowInput, UpdateWorkflowInput } from "../validators/workflow.validator";
import {
  validateConditionConfigurations,
  validateWorkflowGraph,
  type WorkflowGraph,
} from "../validators/workflow-graph.validator";
import { validateTriggerConfigurations } from "../validators/event-contract.validator";


export interface CreateWorkflowCommand {
  tenantId: Types.ObjectId;
  input: CreateWorkflowInput;
}


export interface UpdateWorkflowCommand {
  tenantId: Types.ObjectId;
  workflowId: Types.ObjectId;
  input: UpdateWorkflowInput;
}

export interface CreatedWorkflow {
  tenantId: Types.ObjectId;
  name: string;
  description?: string;
  graph: WorkflowGraph;
  status: "draft";
  version: 1;
}

export type ActivateWorkflowResult =
  | { outcome: "success"; workflow: unknown }
  | { outcome: "not_found" }
  | { outcome: "invalid_status"; currentStatus: string }
  | { outcome: "invalid_graph"; errors: string[] };

export interface WorkflowServiceDependencies {
  createWorkflowRecord(record: CreatedWorkflow): Promise<unknown>;
  findWorkflowRecordsByTenant(tenantId: Types.ObjectId): Promise<unknown[]>;
  updateWorkflowRecord?(
    tenantId: Types.ObjectId,
    workflowId: Types.ObjectId,
    updates: UpdateWorkflowInput,
  ): Promise<unknown | null>;
  updateWorkflowGraph?(
    tenantId: Types.ObjectId,
    workflowId: Types.ObjectId,
    graph: WorkflowGraph,
  ): Promise<unknown | null>;
  deleteWorkflow?(
    tenantId: Types.ObjectId,
    workflowId: Types.ObjectId,
  ): Promise<unknown | null>;
  activateWorkflowRecord?(
    tenantId: Types.ObjectId,
    workflowId: Types.ObjectId,
    expectedVersion?: number,
  ): Promise<unknown | null>;
  findWorkflowRecordById?(
    tenantId: Types.ObjectId,
    workflowId: Types.ObjectId,
  ): Promise<unknown | null>;
}

const databaseDependencies: WorkflowServiceDependencies = {
  async createWorkflowRecord(record) {
    return WorkflowModel.create(record);
  },

  async findWorkflowRecordsByTenant(tenantId) {
    return WorkflowModel.find({ tenantId })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  },

  async updateWorkflowRecord(tenantId, workflowId, updates) {
    return WorkflowModel.findOneAndUpdate(
      { _id: workflowId, tenantId },
      { $set: updates, $inc: { version: 1 } },
      { new: true, runValidators: true },
    ).lean().exec();
  },

  async updateWorkflowGraph(tenantId, workflowId, graph) {
    return WorkflowModel.findOneAndUpdate(
      { _id: workflowId, tenantId },
      { $set: { graph }, $inc: { version: 1 } },
      { new: true, runValidators: true },
    ).lean().exec();
  },

  async deleteWorkflow(tenantId, workflowId) {
    return WorkflowModel.findOneAndDelete({ _id: workflowId, tenantId })
      .lean()
      .exec();
  },

  async activateWorkflowRecord(tenantId, workflowId, expectedVersion) {
    const filter: Record<string, unknown> = {
      _id: workflowId,
      tenantId,
      status: { $in: ["draft", "active"] },
    };
    if (typeof expectedVersion === "number") {
      filter.version = expectedVersion;
    }

    return WorkflowModel.findOneAndUpdate(
      filter,
      { $set: { status: "active" } },
      { new: true, runValidators: true },
    )
      .lean()
      .exec();
  },

  async findWorkflowRecordById(tenantId, workflowId) {
    return WorkflowModel.findOne({ _id: workflowId, tenantId })
      .lean()
      .exec();
  },
};

export function createWorkflowService(
  dependencies: WorkflowServiceDependencies = databaseDependencies,
) {
  return {
    async createWorkflow({
      tenantId,
      input,
    }: CreateWorkflowCommand): Promise<unknown> {
      const name = input.name.trim();

      if (!name) {
        throw new Error("Workflow name must not be empty");
      }


const record: CreatedWorkflow = {
  tenantId,
  name,
  ...(input.description !== undefined
    ? { description: input.description.trim() }
    : {}),
  graph: input.graph,
  status: "draft",
  version: 1,
};


      return dependencies.createWorkflowRecord(record);
    },

    async listWorkflows(tenantId: Types.ObjectId): Promise<unknown[]> {
      return dependencies.findWorkflowRecordsByTenant(tenantId);
    },

    async updateWorkflow({
      tenantId,
      workflowId,
      input,
    }: UpdateWorkflowCommand): Promise<unknown | null> {
      if (!dependencies.updateWorkflowRecord) {
        throw new Error("Workflow updates are not configured");
      }

      return dependencies.updateWorkflowRecord(tenantId, workflowId, input);
    },

    async updateWorkflowGraph(
      tenantId: Types.ObjectId,
      workflowId: string,
      graph: WorkflowGraph,
    ): Promise<unknown | null> {
      if (!/^[a-f\d]{24}$/i.test(workflowId)) {
        return null;
      }

      const graphErrors = validateWorkflowGraph(graph);
      if (graphErrors.length === 0) {
        graphErrors.push(...validateConditionConfigurations(graph));
        graphErrors.push(...validateTriggerConfigurations(graph));
      }
      if (graphErrors.length > 0) {
        throw new Error(`The workflow graph is invalid: ${graphErrors.join("; ")}`);
      }

      if (!dependencies.updateWorkflowGraph) {
        throw new Error("Workflow graph updates are not configured");
      }

      return dependencies.updateWorkflowGraph(
        tenantId,
        new Types.ObjectId(workflowId),
        graph,
      );
    },

    async deleteWorkflow(
      tenantId: Types.ObjectId,
      workflowId: string,
    ): Promise<unknown | null> {
      if (!/^[a-f\d]{24}$/i.test(workflowId)) {
        return null;
      }

      if (!dependencies.deleteWorkflow) {
        throw new Error("Workflow deletion is not configured");
      }

      return dependencies.deleteWorkflow(
        tenantId,
        new Types.ObjectId(workflowId),
      );
    },

    async activateWorkflow(
      tenantId: Types.ObjectId,
      workflowId: string,
    ): Promise<ActivateWorkflowResult> {
      if (!/^[a-f\d]{24}$/i.test(workflowId)) {
        return { outcome: "not_found" };
      }

      if (!dependencies.activateWorkflowRecord) {
        throw new Error("Workflow activation is not configured");
      }

      const id = new Types.ObjectId(workflowId);

      if (dependencies.findWorkflowRecordById) {
        const existing = (await dependencies.findWorkflowRecordById(
          tenantId,
          id,
        )) as
          | { status?: string; graph?: unknown; version?: number }
          | null
          | undefined;

        if (!existing) {
          return { outcome: "not_found" };
        }

        if (
          existing.status &&
          existing.status !== "draft" &&
          existing.status !== "active"
        ) {
          return { outcome: "invalid_status", currentStatus: existing.status };
        }

        const graphErrors = validateWorkflowGraph(existing.graph);
        const conditionErrors =
          graphErrors.length === 0
            ? validateConditionConfigurations(existing.graph)
            : [];
        const triggerErrors =
          graphErrors.length === 0
            ? validateTriggerConfigurations(existing.graph)
            : [];
        const allErrors = [
          ...graphErrors,
          ...conditionErrors,
          ...triggerErrors,
        ];

        if (allErrors.length > 0) {
          return { outcome: "invalid_graph", errors: allErrors };
        }

        const updated = await dependencies.activateWorkflowRecord(
          tenantId,
          id,
          existing.version,
        );

        if (updated) {
          return { outcome: "success", workflow: updated };
        }

        const recheck = (await dependencies.findWorkflowRecordById(
          tenantId,
          id,
        )) as
          | { status?: string; graph?: unknown; version?: number }
          | null
          | undefined;

        if (!recheck) {
          return { outcome: "not_found" };
        }

        if (
          recheck.status &&
          recheck.status !== "draft" &&
          recheck.status !== "active"
        ) {
          return { outcome: "invalid_status", currentStatus: recheck.status };
        }

        const recheckGraphErrors = validateWorkflowGraph(recheck.graph);
        const recheckConditionErrors =
          recheckGraphErrors.length === 0
            ? validateConditionConfigurations(recheck.graph)
            : [];
        const recheckTriggerErrors =
          recheckGraphErrors.length === 0
            ? validateTriggerConfigurations(recheck.graph)
            : [];
        const recheckAllErrors = [
          ...recheckGraphErrors,
          ...recheckConditionErrors,
          ...recheckTriggerErrors,
        ];

        if (recheckAllErrors.length > 0) {
          return { outcome: "invalid_graph", errors: recheckAllErrors };
        }

        const retryUpdated = await dependencies.activateWorkflowRecord(
          tenantId,
          id,
          recheck.version,
        );

        if (retryUpdated) {
          return { outcome: "success", workflow: retryUpdated };
        }

        return { outcome: "not_found" };
      }

      const fallbackUpdated = await dependencies.activateWorkflowRecord(
        tenantId,
        id,
      );
      if (fallbackUpdated) {
        return { outcome: "success", workflow: fallbackUpdated };
      }

      return { outcome: "not_found" };
    },
  };
}
