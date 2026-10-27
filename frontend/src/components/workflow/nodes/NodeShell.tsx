import { Handle, Position } from "@xyflow/react";
import {
  HANDLE,
  NODE_KIND_LABEL,
  type WorkflowNodeType,
} from "./node.types";
import "./node.css";

interface NodeShellProps {
  kind: WorkflowNodeType;
  label: string;
  selected?: boolean;
}

function NodeShell({ kind, label, selected = false }: NodeShellProps) {
  return (
    <div
      className={`workflow-node workflow-node--${kind}${
        selected ? " workflow-node--selected" : ""
      }`}
    >
      {/*
        Trigger nodes are entry points and have no target handle.
        Task and condition nodes share the same target handle id.
      */}
      {kind !== "trigger" && (
        <Handle
          type="target"
          position={Position.Top}
          id={HANDLE.target}
          className="workflow-node__handle"
        />
      )}

      <span className="workflow-node__kind">{NODE_KIND_LABEL[kind]}</span>
      <p className="workflow-node__label">{label}</p>

      {kind === "condition" ? (
        <>
          {/*
            Condition source handles are literally "true" and "false" per
            the agreed contract. Both are required and must be preserved
            as `edge.sourceHandle` on outgoing edges.
          */}
          <div className="workflow-node__branches" aria-hidden="true">
            <span className="workflow-node__branch-label workflow-node__branch-label--true">
              True (Yes)
            </span>
            <span className="workflow-node__branch-label workflow-node__branch-label--false">
              False (No)
            </span>
          </div>
          <Handle
            type="source"
            position={Position.Bottom}
            id={HANDLE.branchTrue}
            className="workflow-node__handle workflow-node__handle--true"
            aria-label="True (Yes) branch"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id={HANDLE.branchFalse}
            className="workflow-node__handle workflow-node__handle--false"
            aria-label="False (No) branch"
          />
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          id={HANDLE.source}
          className="workflow-node__handle"
          aria-label="Next step"
        />
      )}
    </div>
  );
}

export default NodeShell;
