import type { NodeProps } from "@xyflow/react";
import NodeShell from "./NodeShell";
import type { ConditionNodeData, WorkflowFlowNode } from "./node.types";

type ConditionFlowNode = WorkflowFlowNode & { data: ConditionNodeData };

function ConditionNode({ data, selected }: NodeProps<ConditionFlowNode>) {
  return <NodeShell kind="condition" label={data.label} selected={selected} />;
}

export default ConditionNode;