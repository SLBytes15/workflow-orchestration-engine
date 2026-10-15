import type { Edge, Node } from "@xyflow/react";

export type WorkflowNodeType = "trigger" | "task" | "condition";

interface WorkflowNodeBase extends Record<string, unknown> {
  label: string;
  config?: Record<string, unknown>;
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