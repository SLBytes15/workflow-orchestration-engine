import type { WorkflowGraph } from "../validators/workflow-graph.validator";

export interface ExecutionGraphCase {
  name: string;
  graph: WorkflowGraph;
  input: Record<string, unknown>;
  expectedNodeIds: string[];
}

/**
 * Minimal linear graph: trigger -> task.
 */
export function linearGraphCase(): ExecutionGraphCase {
  return {
    name: "linear trigger to task",
    input: {},
    expectedNodeIds: ["trigger-1", "task-1"],
    graph: {
      version: 1,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          position: { x: 0, y: 0 },
          data: { type: "trigger", label: "Start" },
        },
        {
          id: "task-1",
          type: "task",
          position: { x: 200, y: 0 },
          data: { type: "task", label: "Record order" },
        },
      ],
      edges: [{ id: "edge-1", source: "trigger-1", target: "task-1" }],
    },
  };
}

/**
 * Condition graph using the canonical `data.config` clause format.
 * Both condition branches must exist, even though only one is traversed.
 */
export function conditionGraphCase(
  branch: "true" | "false",
): ExecutionGraphCase {
  return {
    name: `condition ${branch} branch`,
    input: { approved: branch === "true" },
    expectedNodeIds: [
      "trigger-1",
      "condition-1",
      branch === "true" ? "task-true" : "task-false",
    ],
    graph: {
      version: 1,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          position: { x: 0, y: 0 },
          data: { type: "trigger", label: "Order created" },
        },
        {
          id: "condition-1",
          type: "condition",
          position: { x: 200, y: 0 },
          data: {
            type: "condition",
            label: "Payment approved?",
            config: {
              type: "clause",
              clause: {
                left: "approved",
                op: "equals",
                right: true,
              },
            },
          },
        },
        {
          id: "task-true",
          type: "task",
          position: { x: 400, y: -80 },
          data: { type: "task", label: "Confirm order" },
        },
        {
          id: "task-false",
          type: "task",
          position: { x: 400, y: 80 },
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
    },
  };
}

export function executionGraphCases(): ExecutionGraphCase[] {
  return [
    linearGraphCase(),
    conditionGraphCase("true"),
    conditionGraphCase("false"),
  ];
}
