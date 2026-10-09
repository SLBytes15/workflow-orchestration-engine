import type { WorkflowNodeData } from "./node.types";

interface TriggerNodeProps {
  data: WorkflowNodeData;
}

function TriggerNode({ data }: TriggerNodeProps) {
  return (
    <div>
      <strong>Trigger</strong>
      <p>{data.label}</p>
    </div>
  );
}

export default TriggerNode;