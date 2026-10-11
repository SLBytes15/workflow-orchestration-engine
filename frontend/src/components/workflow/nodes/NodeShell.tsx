import { NODE_KIND_LABEL } from "./node.types";
import type { WorkflowNodeType } from "./node.types";
import "./node.css";

interface NodeShellProps {
  kind: WorkflowNodeType;
  label: string;
}

function NodeShell({ kind, label }: NodeShellProps) {
  return (
    <div className={`workflow-node workflow-node--${kind}`}>
      <span className="workflow-node__kind">{NODE_KIND_LABEL[kind]}</span>
      <p className="workflow-node__label">{label}</p>
    </div>
  );
}

export default NodeShell;