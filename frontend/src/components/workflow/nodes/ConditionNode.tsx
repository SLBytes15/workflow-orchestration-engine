import NodeShell from "./NodeShell";
import type { WorkflowNodeData } from "./node.types";

type ConditionNodeProps = {
  data: WorkflowNodeData & { type: "condition" };
  selected?: boolean;
};

function ConditionNode({ data, selected }: ConditionNodeProps) {
  return <NodeShell kind={data.type} label={data.label} selected={selected} />;
}

export default ConditionNode;