import NodeShell from "./NodeShell";
import type { WorkflowNodeData } from "./node.types";

interface TaskNodeProps {
  data: WorkflowNodeData;
}

function TaskNode({ data }: TaskNodeProps) {
  return <NodeShell kind="task" label={data.label} />;
}

export default TaskNode;