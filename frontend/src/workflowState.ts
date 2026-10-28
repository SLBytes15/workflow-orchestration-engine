import { isWorkflowGraph, type WorkflowGraph } from "./api/workflowApi";

export type WorkflowStatus = "Active" | "Draft" | "Paused";

export type Workflow = {
  id: string | number;
  isPersisted: boolean;
  name: string;
  description: string;
  status: WorkflowStatus;
  version: number;
  updatedAt: string;
  graph?: WorkflowGraph;
};

export const initialWorkflows: Workflow[] = [
  {
    id: 1,
    isPersisted: false,
    name: "Payment Processing",
    description: "Handles payment-related workflow operations.",
    status: "Active",
    version: 1,
    updatedAt: "2026-10-10",
  },
  {
    id: 2,
    isPersisted: false,
    name: "Order Management",
    description: "Manages order creation, tracking, and completion.",
    status: "Draft",
    version: 2,
    updatedAt: "2026-10-09",
  },
  {
    id: 3,
    isPersisted: false,
    name: "Customer Notifications",
    description: "Sends notifications to customers.",
    status: "Paused",
    version: 1,
    updatedAt: "2026-10-08",
  },
];

type WorkflowRecord = {
  id?: unknown;
  _id?: unknown;
  name?: unknown;
  description?: unknown;
  status?: unknown;
  version?: unknown;
  updatedAt?: unknown;
  graph?: unknown;
};

function isRecord(value: unknown): value is WorkflowRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readWorkflowId(record: WorkflowRecord): string | undefined {
  for (const value of [record.id, record._id]) {
    if (typeof value === "string" && value.trim()) return value;
  }
}

export function normalizeStatus(status: unknown): WorkflowStatus {
  if (typeof status === "string") {
    const s = status.trim().toLowerCase();
    if (s === "active") return "Active";
    if (s === "paused") return "Paused";
    if (s === "draft") return "Draft";
  }
  return "Draft";
}

export function mapPersistedWorkflow(
  value: unknown,
  defaults: { name?: string; description?: string } = {},
): Workflow {
  if (!isRecord(value)) {
    throw new Error("The backend response did not contain a saved workflow.");
  }

  const id = readWorkflowId(value);

  if (!id) {
    throw new Error(
      "The backend response did not contain a valid saved workflow ID.",
    );
  }

  const workflow: Workflow = {
    id,
    isPersisted: true,
    name:
      typeof value.name === "string"
        ? value.name
        : defaults.name ?? "Untitled workflow",
    description:
      typeof value.description === "string"
        ? value.description
        : defaults.description ?? "No description provided.",
    status: normalizeStatus(value.status),
    version:
      typeof value.version === "number" ? value.version : 1,
    updatedAt:
      typeof value.updatedAt === "string"
        ? value.updatedAt.slice(0, 10)
        : new Date().toISOString().slice(0, 10),
  };

  if (isWorkflowGraph(value.graph)) {
    workflow.graph = value.graph;
  }

  return workflow;
}

export function mapPersistedWorkflows(value: unknown): Workflow[] {
  if (!Array.isArray(value)) {
    throw new Error("The backend response did not contain a workflow list.");
  }

  return value.map((item) => mapPersistedWorkflow(item));
}

export function mergeSavedWorkflows(
  samples: Workflow[],
  savedWorkflows: Workflow[],
): Workflow[] {
  const savedNames = new Set(
    savedWorkflows.map((workflow) => workflow.name.toLowerCase()),
  );

  return [
    ...samples.filter(
      (workflow) => !savedNames.has(workflow.name.toLowerCase()),
    ),
    ...savedWorkflows,
  ];
}

export function appendWorkflow(
  current: Workflow[],
  workflow: Workflow,
): Workflow[] {
  const alreadyExists = current.some(
    (item) => item.name.toLowerCase() === workflow.name.toLowerCase(),
  );

  return alreadyExists ? current : [...current, workflow];
}

export function removeWorkflow(
  current: Workflow[],
  workflowId: string | number,
): Workflow[] {
  return current.filter((workflow) => workflow.id !== workflowId);
}

export function isRunButtonDisabled(canRun: boolean, isRunning: boolean) {
  return !canRun || isRunning;
}
