import { useState } from "react";
import ConditionNode from "./ConditionNode";
import TaskNode from "./TaskNode";
import TriggerNode from "./TriggerNode";
import type { WorkflowCanvasNode } from "./node.types";
import { NODE_KIND_LABEL } from "./node.types";
import "./node.css";

const canvasNodes: WorkflowCanvasNode[] = [
  {
    id: "trigger-order-created",
    data: {
      type: "trigger",
      label: "Order created",
      config: { event: "order.created" },
    },
  },
  {
    id: "task-charge-payment",
    data: {
      type: "task",
      label: "Charge payment",
      config: { service: "payments.charge" },
    },
  },
  {
    id: "condition-payment-approved",
    data: {
      type: "condition",
      label: "Payment approved?",
      config: { expression: "payment.status === approved" },
    },
  },
];

function NodePreview() {
  const [selectedNodeId, setSelectedNodeId] = useState(canvasNodes[0].id);
  const selectedNode = canvasNodes.find((node) => node.id === selectedNodeId) ?? canvasNodes[0];

  return (
    <section className="node-preview" aria-labelledby="node-preview-title">
      <div className="node-preview__heading">
        <div>
          <p className="node-preview__eyebrow">Editor foundation</p>
          <h2 id="node-preview-title">Interactive workflow canvas</h2>
        </div>
        <p className="node-preview__hint">Select a node to inspect its configuration.</p>
      </div>

      <div className="node-preview__workspace">
        <div className="node-preview__canvas" role="list" aria-label="Workflow nodes">
          {canvasNodes.map((node) => {
            const isSelected = node.id === selectedNode.id;
            return (
              <div key={node.id} role="listitem">
                <button
                  type="button"
                  className={`node-preview__node${isSelected ? " node-preview__node--selected" : ""}`}
                  onClick={() => setSelectedNodeId(node.id)}
                  aria-label={`Select ${node.data.label} ${NODE_KIND_LABEL[node.data.type]} node`}
                  aria-pressed={isSelected}
                >
                  {node.data.type === "trigger" && (
                    <TriggerNode data={node.data} selected={isSelected} />
                  )}
                  {node.data.type === "task" && (
                    <TaskNode data={node.data} selected={isSelected} />
                  )}
                  {node.data.type === "condition" && (
                    <ConditionNode data={node.data} selected={isSelected} />
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <aside className="node-preview__details" aria-live="polite">
          <p className="node-preview__eyebrow">Selected node</p>
          <h3>{selectedNode.data.label}</h3>
          <dl>
            <div>
              <dt>Type</dt>
              <dd>{NODE_KIND_LABEL[selectedNode.data.type]}</dd>
            </div>
            {Object.entries(selectedNode.data.config).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="node-preview__note">
            Demo state only. Saving, execution, and edge connections are not implemented yet.
          </p>
        </aside>
      </div>
    </section>
  );
}

export default NodePreview;