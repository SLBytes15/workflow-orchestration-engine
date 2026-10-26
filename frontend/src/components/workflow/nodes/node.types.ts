import type { Edge, Node } from "@xyflow/react";

export type WorkflowNodeType = "trigger" | "task" | "condition";
import type { WorkflowGraph as ApiWorkflowGraph } from "../../../api/workflowApi";

interface WorkflowNodeBase extends Record<string, unknown> {
  label: string;
  config?: unknown;
}

export type TriggerNodeData = WorkflowNodeBase & { type: "trigger" };
export type TaskNodeData = WorkflowNodeBase & { type: "task" };
export type ConditionNodeData = WorkflowNodeBase & { type: "condition" };

export type WorkflowNodeData =
  | TriggerNodeData
  | TaskNodeData
  | ConditionNodeData;

export type WorkflowFlowNode = Node<WorkflowNodeData, WorkflowNodeType>;
export type WorkflowFlowEdge = Edge;
export const MAX_NODE_LABEL_LENGTH = 120;

export function validateNodeLabel(value: string): string | null {
  const label = value.trim();
  if (!label) return "Node label must not be empty.";
  if (label.length > MAX_NODE_LABEL_LENGTH) {
    return `Node label must be ${MAX_NODE_LABEL_LENGTH} characters or fewer.`;
  }
  return null;
}

export function withNodeLabel(node: Node, label: string): Node {
  if (
    typeof node.data !== "object" ||
    node.data === null ||
    !("label" in node.data)
  ) {
    return node;
  }

  return {
    ...node,
    data: { ...node.data, label: label.trim() },
  };
}

export type ConditionOp =
  | "equals"
  | "notEquals"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "startsWith"
  | "matches"
  | "truthy";

export const CONDITION_OPERATOR_LABELS: Partial<Record<ConditionOp, string>> = {
  equals: "Is equal to",
  notEquals: "Is not equal to",
  gt: "Is greater than",
  gte: "Is at least",
  lt: "Is less than",
  lte: "Is at most",
  contains: "Contains",
  startsWith: "Starts with",
  truthy: "Is present / truthy",
};

export type ConditionValueType = "string" | "number" | "boolean" | "json";

export function getConditionValueType(value: unknown): ConditionValueType {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "json";
}

export function parseConditionValue(
  rawValue: string,
  valueType: ConditionValueType,
): { value?: unknown; error?: string } {
  if (!rawValue.trim()) {
    return { error: "Enter a comparison value." };
  }

  if (valueType === "string") return { value: rawValue };
  if (valueType === "boolean") {
    const booleanValue = rawValue.trim();
    if (booleanValue === "true") return { value: true };
    if (booleanValue === "false") return { value: false };
    return { error: "Choose True or False for the comparison value." };
  }
  if (valueType === "number") {
    const number = Number(rawValue);
    return Number.isFinite(number)
      ? { value: number }
      : { error: "Enter a valid number." };
  }

  try {
    return { value: JSON.parse(rawValue) as unknown };
  } catch {
    return { error: "Enter a valid JSON value." };
  }
}

export function summarizeCondition(
  clause: ConditionConfig["clause"],
): string {
  const operatorLabel = CONDITION_OPERATOR_LABELS[clause.op];
  if (!operatorLabel) return `If ${clause.left} matches the configured condition`;
  if (clause.op === "truthy") return `If ${clause.left} is present / truthy`;

  const value =
    typeof clause.right === "string"
      ? `"${clause.right}"`
      : JSON.stringify(clause.right);
  return `If ${clause.left} ${operatorLabel.toLowerCase()} ${value ?? "undefined"}`;
}

export type ConditionConfig = {
  type: "clause";
  clause: {
    left: string;
    op: ConditionOp;
    right?: unknown;
  };
};

export function createConditionConfigFromInput(
  left: string,
  op: ConditionOp,
  rawValue: string,
  valueType: ConditionValueType,
): { config?: ConditionConfig; error?: string } {
  if (!left.trim()) return { error: "Enter what you want to check." };

  if (op === "truthy") {
    return {
      config: {
        type: "clause",
        clause: { left: left.trim(), op },
      },
    };
  }

  const parsed = parseConditionValue(rawValue, valueType);
  if (parsed.error) return { error: parsed.error };

  return {
    config: {
      type: "clause",
      clause: { left: left.trim(), op, right: parsed.value },
    },
  };
}

export function createConditionConfig(): ConditionConfig {
  return {
    type: "clause",
    clause: {
      left: "approved",
      op: "equals",
      right: true,
    },
  };
}

export function createConditionNode(
  id: string,
  position: { x: number; y: number },
): WorkflowFlowNode {
  return {
    id,
    type: "condition",
    position,
    data: {
      type: "condition",
      label: "Condition",
      config: createConditionConfig(),
    },
  };
}

export function withConditionConfig(
  node: Node,
  config: ConditionConfig,
): Node {
  if (
    node.type !== "condition" ||
    typeof node.data !== "object" ||
    node.data === null ||
    !("type" in node.data) ||
    node.data.type !== "condition"
  ) {
    return node;
  }

  return {
    ...node,
    data: { ...node.data, config },
  };
}

export function serializeWorkflowGraph(
  nodes: Node[],
  edges: Edge[],
): ApiWorkflowGraph {
  return {
    version: 1,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type as "trigger" | "task" | "condition",
      position: node.position,
      data: {
        ...node.data,
        type: node.type as "trigger" | "task" | "condition",
        label: String(node.data.label ?? ""),
      },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle !== null
        ? { sourceHandle: edge.sourceHandle }
        : {}),
      ...(edge.targetHandle !== null
        ? { targetHandle: edge.targetHandle }
        : {}),
      ...(edge.data !== undefined ? { data: edge.data } : {}),
    })),
  };
}

export function hasValidConditionConfig(data: unknown): boolean {
  if (typeof data !== "object" || data === null || !("config" in data)) {
    return false;
  }

  const config = data.config;
  if (
    typeof config !== "object" ||
    config === null ||
    !("type" in config) ||
    config.type !== "clause" ||
    !("clause" in config)
  ) {
    return false;
  }

  const clause = config.clause;
  return (
    typeof clause === "object" &&
    clause !== null &&
    "left" in clause &&
    typeof clause.left === "string" &&
    Boolean(clause.left.trim()) &&
    "op" in clause &&
    typeof clause.op === "string" &&
    [
      "equals",
      "notEquals",
      "gt",
      "gte",
      "lt",
      "lte",
      "contains",
      "startsWith",
      "truthy",
    ].includes(clause.op) &&
    (clause.op === "truthy" || "right" in clause)
  );
}

export function getConditionConfigError(graph: ApiWorkflowGraph): string | null {
  const invalidCondition = graph.nodes.find(
    (node) => node.type === "condition" && !hasValidConditionConfig(node.data),
  );
  return invalidCondition
    ? `Condition node "${invalidCondition.data.label}" is missing a valid clause configuration. Open the workflow in Node Preview and configure it before running.`
    : null;
}

export interface WorkflowGraph {
  version: 1;
  nodes: WorkflowFlowNode[];
  edges: WorkflowFlowEdge[];
}

export const NODE_KIND_LABEL: Record<WorkflowNodeType, string> = {
  trigger: "Trigger",
  task: "Task",
  condition: "Condition",
};
// ── Handle ID constants — single source of truth for the canvas ───
export const HANDLE = {
  target: "target",
  source: "source",
  branchTrue: "true",
  branchFalse: "false",
} as const;