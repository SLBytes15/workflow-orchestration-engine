import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeWorkflowGraph } from "./execution.runtime";
import type { WorkflowGraph } from "../validators/workflow-graph.validator";

function createGraph(): WorkflowGraph {
  return {
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
        position: { x: 100, y: 0 },
        // conditionKey is a proposed runtime field, not yet
        // part of the current WorkflowGraph interface.
        data: {
          type: "condition",
          label: "Payment approved?",
          conditionKey: "approved",
        } as WorkflowGraph["nodes"][number]["data"],
      },
      {
        id: "task-true",
        type: "task",
        position: { x: 200, y: -50 },
        data: { type: "task", label: "Confirm order" },
      },
      {
        id: "task-false",
        type: "task",
        position: { x: 200, y: 50 },
        data: { type: "task", label: "Reject order" },
      },
    ],
    edges: [
      {
        id: "edge-1",
        source: "trigger-1",
        target: "condition-1",
      },
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
}

describe("executeWorkflowGraph", () => {
  it("executes the true branch when the condition input is true", async () => {
    const graph = createGraph();

    const result = await executeWorkflowGraph(graph, {
      approved: true,
    });

    assert.equal(result.status, "completed");

    const completedNodeIds = result.nodeResults
      .filter((node) => node.status === "completed")
      .map((node) => node.nodeId);

    assert.deepEqual(completedNodeIds, [
      "trigger-1",
      "condition-1",
      "task-true",
    ]);

    assert.equal(completedNodeIds.includes("task-false"), false);
  });

  it("executes the false branch when the condition input is false", async () => {
    const graph = createGraph();

    const result = await executeWorkflowGraph(graph, {
      approved: false,
    });

    assert.equal(result.status, "completed");

    const completedNodeIds = result.nodeResults
      .filter((node) => node.status === "completed")
      .map((node) => node.nodeId);

    assert.deepEqual(completedNodeIds, [
      "trigger-1",
      "condition-1",
      "task-false",
    ]);

    assert.equal(completedNodeIds.includes("task-true"), false);
  });

  it("fails when the required condition input is missing", async () => {
    const graph = createGraph();

    const result = await executeWorkflowGraph(graph, {});

    assert.equal(result.status, "failed");
    assert.ok(result.error);
    assert.equal(
      result.nodeResults.some(
        (node) => node.nodeId === "task-true" || node.nodeId === "task-false",
      ),
      false,
    );
  });

  it("fails when the condition input is not a boolean", async () => {
    const graph = createGraph();

    const result = await executeWorkflowGraph(graph, {
      approved: "yes",
    });

    assert.equal(result.status, "failed");
    assert.ok(result.error);
  });

  it("does not execute both condition branches", async () => {
    const graph = createGraph();

    const result = await executeWorkflowGraph(graph, {
      approved: true,
    });

    const completedNodeIds = result.nodeResults
      .filter((node) => node.status === "completed")
      .map((node) => node.nodeId);

    assert.equal(completedNodeIds.includes("task-true"), true);
    assert.equal(completedNodeIds.includes("task-false"), false);
  });

  it("does not mutate the original graph", async () => {
    const graph = createGraph();
    const originalGraph = structuredClone(graph);

    await executeWorkflowGraph(graph, { approved: true });

    assert.deepEqual(graph, originalGraph);
  });
});
