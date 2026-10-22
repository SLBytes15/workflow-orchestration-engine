import type { WorkflowGraph } from "./workflow-graph.validator";

export const validGraph: WorkflowGraph = {
  version: 1,
  nodes: [
    {
      id: "trigger-1",
      type: "trigger",
      position: { x: 100, y: 100 },
      data: { type: "trigger", label: "Order created" },
    },
    {
      id: "condition-1",
      type: "condition",
      position: { x: 300, y: 100 },
      data: {
        type: "condition",
        label: "Order valid?",
        config: {
          type: "clause",
          clause: { left: "approved", op: "equals", right: true },
        },
      },
    },
    {
      id: "task-true",
      type: "task",
      position: { x: 500, y: 50 },
      data: { type: "task", label: "Process order" },
    },
    {
      id: "task-false",
      type: "task",
      position: { x: 500, y: 200 },
      data: { type: "task", label: "Reject order" },
    },
  ],
  edges: [
    { id: "edge-1", source: "trigger-1", target: "condition-1" },
    {
      id: "edge-2",
      source: "condition-1",
      target: "task-true",
      sourceHandle: "true",
    },
    {
      id: "edge-3",
      source: "condition-1",
      target: "task-false",
      sourceHandle: "false",
    },
  ],
};
