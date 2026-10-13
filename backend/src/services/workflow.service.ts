import type { Types } from "mongoose";
import WorkflowModel from "../models/workflow.model";
import type { CreateWorkflowInput } from "../validators/workflow.validator";

export interface CreateWorkflowCommand {
  tenantId: Types.ObjectId;
  input: CreateWorkflowInput;
}

export interface CreatedWorkflow {
  tenantId: Types.ObjectId;
  name: string;
  description?: string;
  status: "draft";
  version: 1;
}

export interface WorkflowServiceDependencies {
  createWorkflowRecord(record: CreatedWorkflow): Promise<unknown>;
}

const databaseDependencies: WorkflowServiceDependencies = {
  async createWorkflowRecord(record) {
    return WorkflowModel.create(record);
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
      const record: CreatedWorkflow = {
        tenantId,
        name: input.name,
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        status: "draft",
        version: 1,
      };

      return dependencies.createWorkflowRecord(record);
    },
  };
}
