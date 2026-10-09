export type WorkflowNodeType = "trigger" | "task" | "condition";

export interface WorkflowNodeData {
  label: string;
  type: WorkflowNodeType;
}