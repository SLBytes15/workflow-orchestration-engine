import { Types } from "mongoose";
import WorkflowModel from "../models/workflow.model";
import type { CreateWorkflowInput } from "../validators/workflow.validator";
import type { WorkflowGraph } from "../validators/workflow-graph.validator";


export interface CreateWorkflowCommand {
  tenantId: Types.ObjectId;
  input: CreateWorkflowInput;
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
  updateWorkflowGraph(
    tenantId: Types.ObjectId,
    workflowId: Types.ObjectId,
    graph: WorkflowGraph,
  ): Promise<unknown | null>;
  deleteWorkflow(
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

  async updateWorkflowGraph(tenantId, workflowId, graph) {
    return WorkflowModel.findOneAndUpdate(
      { _id: workflowId, tenantId },
      { $set: { graph }, $inc: { version: 1 } },
      { new: true, runValidators: true },
    )
      .lean()
      .exec();
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

    async updateWorkflowGraph(
      tenantId: Types.ObjectId,
      workflowIdValue: string,
      graph: WorkflowGraph,
    ): Promise<unknown | null> {
      if (!/^[a-f\d]{24}$/i.test(workflowIdValue)) {
        return null;
      }

      return dependencies.updateWorkflowGraph(
        tenantId,
        new Types.ObjectId(workflowIdValue),
        graph,
      );
    },

    async deleteWorkflow(
      tenantId: Types.ObjectId,
      workflowIdValue: string,
    ): Promise<unknown | null> {
      if (!/^[a-f\d]{24}$/i.test(workflowIdValue)) {
        return null;
      }

      return dependencies.deleteWorkflow(
        tenantId,
        new Types.ObjectId(workflowIdValue),
      );
    },
  };
}
