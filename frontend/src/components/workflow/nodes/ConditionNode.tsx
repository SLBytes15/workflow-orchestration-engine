import type { WorkflowNodeData } from "./node.types";

interface ConditionNodeProps {
  data: WorkflowNodeData;
}

function ConditionNode({ data }: ConditionNodeProps) {
  return (
    <div>
      <strong>Condition</strong>
      <p>{data.label}</p>
    </div>
  );
}

export default ConditionNode;