import type { Types } from "mongoose";
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
  };
}
