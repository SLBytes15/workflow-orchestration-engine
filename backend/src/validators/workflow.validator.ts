import {
  validateWorkflowGraph,
  validateConditionConfigurations,
  type WorkflowGraph,
} from "./workflow-graph.validator";
import { validateTriggerConfigurations } from "./event-contract.validator";

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  graph: WorkflowGraph;
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  status?: "draft" | "active" | "paused";
}

export interface ValidationResult<T = CreateWorkflowInput> {
  valid: boolean;
  errors: string[];
  data?: T;
}

const ALLOWED_STATUSES = ["draft", "active", "paused"] as const;

export function validateCreateWorkflow(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      valid: false,
      errors: ["Request body must be a JSON object"],
    };
  }

  const body = input as Record<string, unknown>;

  if (typeof body.name !== "string" || !body.name.trim()) {
    errors.push("name is required and must be a non-empty string");
  } else if (body.name.trim().length > 120) {
    errors.push("name must not exceed 120 characters");
  }

  if (body.description !== undefined && typeof body.description !== "string") {
    errors.push("description must be a string");
  } else if (
    typeof body.description === "string" &&
    body.description.length > 2000
  ) {
    errors.push("description must not exceed 2000 characters");
  }

  if (body.status !== undefined) {
    errors.push(
      "status cannot be supplied during creation; new workflows start as draft",
    );
  }

  // These fields are server-managed, not client-controlled.
  if (body.tenantId !== undefined) {
    errors.push("tenantId must not be supplied in the request body");
  }

  if (body.version !== undefined) {
    errors.push("version must not be supplied in the request body");
  }


  if (body.graph === undefined) {
    errors.push("graph is required");
  } else {
    const graphErrors = validateWorkflowGraph(body.graph);
    errors.push(...graphErrors.map((error) => `graph: ${error}`));
    if (graphErrors.length === 0) {
      errors.push(
        ...validateConditionConfigurations(body.graph).map(
          (error) => `graph: ${error}`,
        ),
      );
      errors.push(
        ...validateTriggerConfigurations(body.graph).map(
          (error) => `graph: ${error}`,
        ),
      );
    }
  }


  if (errors.length > 0) {
    return { valid: false, errors };
  }


  const data: CreateWorkflowInput = {
    name: (body.name as string).trim(),
    graph: body.graph as WorkflowGraph,
  };

  if (typeof body.description === "string") {
    data.description = body.description.trim();
  }

  return { valid: true, errors: [], data };

}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  graph?: WorkflowGraph;
}

export function validateUpdateWorkflow(
  input: unknown,
): ValidationResult<UpdateWorkflowInput> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      valid: false,
      errors: ["Request body must be a JSON object"],
    };
  }

  const body = input as Record<string, unknown>;
  const errors: string[] = [];
  const allowedFields = ["name", "description", "graph"];
  const providedFields = Object.keys(body);

  if (providedFields.length === 0) {
    errors.push("At least one editable field must be supplied");
  }

  for (const field of providedFields) {
    if (!allowedFields.includes(field)) {
      if (field === "status") {
        errors.push("status cannot be changed through general updates");
      } else if (field === "tenantId" || field === "version") {
        errors.push(`${field} must not be supplied in the request body`);
      } else {
        errors.push(`Unknown field: ${field}`);
      }
    }
  }

  let name: string | undefined;
  let description: string | undefined;

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      errors.push("name must be a non-empty string");
    } else if (body.name.trim().length > 120) {
      errors.push("name must not exceed 120 characters");
    } else {
      name = body.name.trim();
    }
  }

  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      errors.push("description must be a string");
    } else if (body.description.length > 2000) {
      errors.push("description must not exceed 2000 characters");
    } else {
      description = body.description.trim();
    }
  }

  let graph: WorkflowGraph | undefined;

  if (body.graph !== undefined) {
    const graphErrors = validateWorkflowGraph(body.graph);
    errors.push(...graphErrors.map((error) => `graph: ${error}`));
    if (graphErrors.length === 0) {
      errors.push(
        ...validateConditionConfigurations(body.graph).map(
          (error) => `graph: ${error}`,
        ),
      );
      errors.push(
        ...validateTriggerConfigurations(body.graph).map(
          (error) => `graph: ${error}`,
        ),
      );
      if (errors.length === 0) {
        graph = body.graph as WorkflowGraph;
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const data: UpdateWorkflowInput = {};

  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description;
  if (graph !== undefined) data.graph = graph;

  return { valid: true, errors: [], data };
}
