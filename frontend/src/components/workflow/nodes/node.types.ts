export type WorkflowNodeType = "trigger" | "task" | "condition";

interface WorkflowNodeBase {
  label: string;
  config: Record<string, string>;
}

export type WorkflowNodeData = WorkflowNodeBase &
  ({ type: "trigger" } | { type: "task" } | { type: "condition" });

export interface WorkflowCanvasNode {
  id: string;
  data: WorkflowNodeData;
}

export const NODE_KIND_LABEL: Record<WorkflowNodeType, string> = {
  trigger: "Trigger",
  task: "Task",
  condition: "Condition",
};