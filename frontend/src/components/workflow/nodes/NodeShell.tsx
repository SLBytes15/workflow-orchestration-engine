import { NODE_KIND_LABEL } from "./node.types";
import type { WorkflowNodeType } from "./node.types";
import "./node.css";

interface NodeShellProps {
  kind: WorkflowNodeType;
  label: string;
  selected?: boolean;
}

function NodeShell({ kind, label, selected = false }: NodeShellProps) {
  return (
    <div
      className={`workflow-node workflow-node--${kind}${selected ? " workflow-node--selected" : ""}`}
      aria-selected={selected}
    >
      <span className="workflow-node__kind">{NODE_KIND_LABEL[kind]}</span>
      <p className="workflow-node__label">{label}</p>
    </div>
  );
}

export default NodeShell;