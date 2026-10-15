import type { NodeProps } from "@xyflow/react";
import NodeShell from "./NodeShell";
import type { WorkflowFlowNode, TriggerNodeData } from "./node.types";

type TriggerFlowNode = WorkflowFlowNode & { data: TriggerNodeData };

function TriggerNode({ data, selected }: NodeProps<TriggerFlowNode>) {
  return <NodeShell kind="trigger" label={data.label} selected={selected} />;
}

export default TriggerNode;