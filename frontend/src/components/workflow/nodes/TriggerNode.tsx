import NodeShell from "./NodeShell";
import type { WorkflowNodeData } from "./node.types";

interface TriggerNodeProps {
  data: WorkflowNodeData;
}

function TriggerNode({ data }: TriggerNodeProps) {
  return <NodeShell kind="trigger" label={data.label} />;
}

export default TriggerNode;