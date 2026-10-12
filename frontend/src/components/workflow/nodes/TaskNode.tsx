import NodeShell from "./NodeShell";
import type { WorkflowNodeData } from "./node.types";

type TaskNodeProps = {
  data: WorkflowNodeData & { type: "task" };
};

function TaskNode({ data }: TaskNodeProps) {
  return <NodeShell kind={data.type} label={data.label} />;
}

export default TaskNode;