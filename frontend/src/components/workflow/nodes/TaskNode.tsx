import NodeShell from "./NodeShell";
import type { WorkflowNodeData } from "./node.types";

type TaskNodeProps = {
  data: WorkflowNodeData & { type: "task" };
  selected?: boolean;
};

function TaskNode({ data, selected }: TaskNodeProps) {
  return <NodeShell kind={data.type} label={data.label} selected={selected} />;
}

export default TaskNode;