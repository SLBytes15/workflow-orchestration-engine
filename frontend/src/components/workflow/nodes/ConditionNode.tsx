import NodeShell from "./NodeShell";
import type { WorkflowNodeData } from "./node.types";

type ConditionNodeProps = {
  data: WorkflowNodeData & { type: "condition" };
};

function ConditionNode({ data }: ConditionNodeProps) {
  return <NodeShell kind={data.type} label={data.label} />;
}

export default ConditionNode;