import { Types } from "mongoose";
import WorkflowModel from "../models/workflow.model";
import type { CreateWorkflowInput, UpdateWorkflowInput } from "../validators/workflow.validator";
import {
  validateConditionConfigurations,
  validateWorkflowGraph,
  type WorkflowGraph,
} from "../validators/workflow-graph.validator";


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
  };
}
