import ConditionNode from "./ConditionNode";
import TaskNode from "./TaskNode";
import TriggerNode from "./TriggerNode";
import type { WorkflowNodeData } from "./node.types";
import "./node.css";

const triggerExample: WorkflowNodeData & { type: "trigger" } = {
  type: "trigger",
  label: "Order created",
};

const taskExample: WorkflowNodeData & { type: "task" } = {
  type: "task",
  label: "Charge payment",
};

const conditionExample: WorkflowNodeData & { type: "condition" } = {
  type: "condition",
  label: "Payment approved?",
};

function NodePreview() {
  return (
    <section className="node-preview">
      <h2>Node components</h2>

      <div className="node-preview__row">
        <TriggerNode data={triggerExample} />
        <TaskNode data={taskExample} />
        <ConditionNode data={conditionExample} />
      </div>
    </section>
  );
}

export default NodePreview;