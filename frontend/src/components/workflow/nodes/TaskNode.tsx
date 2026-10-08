import type { WorkflowNodeData } from "./node.types";

interface TaskNodeProps {
  data: WorkflowNodeData;
}

function TaskNode({ data }: TaskNodeProps) {
  return (
    <div>
      <strong>Task</strong>
      <p>{data.label}</p>
    </div>
  );
}

export default TaskNode;