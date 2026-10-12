import NodeShell from "./NodeShell";
import type { WorkflowNodeData } from "./node.types";

type TriggerNodeProps = {
  data: WorkflowNodeData & { type: "trigger" };
};

function TriggerNode({ data }: TriggerNodeProps) {
  return <NodeShell kind={data.type} label={data.label} />;
}

export default TriggerNode;