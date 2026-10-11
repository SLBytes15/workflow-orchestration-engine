import NodeShell from "./NodeShell";
import type { WorkflowNodeData } from "./node.types";

interface ConditionNodeProps {
  data: WorkflowNodeData;
}

function ConditionNode({ data }: ConditionNodeProps) {
  return <NodeShell kind="condition" label={data.label} />;
}

export default ConditionNode;