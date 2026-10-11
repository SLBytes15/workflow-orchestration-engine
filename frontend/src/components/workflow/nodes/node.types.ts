export type WorkflowNodeType = "trigger" | "task" | "condition";

export interface WorkflowNodeData {
  label: string;
  type: WorkflowNodeType;
}

export const NODE_KIND_LABEL: Record<WorkflowNodeType, string> = {
  trigger: "Trigger",
  task: "Task",
  condition: "Condition",
};