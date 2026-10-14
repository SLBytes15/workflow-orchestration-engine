import NodeShell from "./NodeShell";
import type { WorkflowNodeData } from "./node.types";

type TriggerNodeProps = {
  data: WorkflowNodeData & { type: "trigger" };
  selected?: boolean;
};

function TriggerNode({ data, selected }: TriggerNodeProps) {
  return <NodeShell kind={data.type} label={data.label} selected={selected} />;
}

export default TriggerNode;