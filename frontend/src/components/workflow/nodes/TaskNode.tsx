import type { NodeProps } from "@xyflow/react";
import NodeShell from "./NodeShell";
import type { TaskNodeData, WorkflowFlowNode } from "./node.types";

type TaskFlowNode = WorkflowFlowNode & { data: TaskNodeData };

function TaskNode({ data, selected }: NodeProps<TaskFlowNode>) {
  return <NodeShell kind="task" label={data.label} selected={selected} />;
}

export default TaskNode;