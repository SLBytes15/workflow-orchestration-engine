import assert from "node:assert/strict";
import { test } from "node:test";

import { validateWorkflowGraph } from "./workflow-graph.validator";
import { version } from "node:os";

const validGraph = {
    version:1,
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
      position: { x: 350, y: 100 },
      data: { type: "condition", label: "Payment approved?" },
    },
    {
      id: "task-1",
      type: "task",
      position: { x: 600, y: 40 },
      data: { type: "task", label: "Confirm order" },
    },
    {
      id: "task-2",
      type: "task",
      position: { x: 600, y: 200 },
      data: { type: "task", label: "Reject order" },
    },
  ],
  edges: [
    { id: "edge-1", source: "trigger-1", target: "condition-1" },
    {
      id: "edge-2",
      source: "condition-1",
      target: "task-1",
      sourceHandle: "true",
    },
    {
      id: "edge-3",
      source: "condition-1",
      target: "task-2",
      sourceHandle: "false",
    },
  ],
};

test("accepts the supplied valid condition graph", () => {
  assert.deepEqual(validateWorkflowGraph(validGraph), []);
});

test("rejects a non-object graph", () => {
  assert.ok(validateWorkflowGraph(null).length > 0);
});

test("rejects missing node and edge arrays", () => {
  assert.ok(validateWorkflowGraph({}).length > 0);
});

test("rejects unsupported node types", () => {
  const graph = structuredClone(validGraph);
  graph.nodes[0].type = "email" as "trigger";

  assert.ok(
    validateWorkflowGraph(graph).some((error) =>
      error.includes("nodes[0].type"),
    ),
  );
});

test("rejects mismatched node data type", () => {
  const graph = structuredClone(validGraph);
  graph.nodes[0].data.type = "task";

  assert.ok(
    validateWorkflowGraph(graph).some((error) =>
      error.includes("data.type must match"),
    ),
  );
});

test("rejects an empty node label", () => {
  const graph = structuredClone(validGraph);
  graph.nodes[0].data.label = " ";

  assert.ok(
    validateWorkflowGraph(graph).some((error) =>
      error.includes("label"),
    ),
  );
});

test("rejects duplicate node IDs", () => {
  const graph = structuredClone(validGraph);
  graph.nodes[1].id = graph.nodes[0].id;

  assert.ok(
    validateWorkflowGraph(graph).some((error) =>
      error.includes("must be unique"),
    ),
  );
});

test("rejects an edge with a missing target", () => {
  const graph = structuredClone(validGraph);
  graph.edges[0].target = "missing-node";

  assert.ok(
    validateWorkflowGraph(graph).some((error) =>
      error.includes("target must reference"),
    ),
  );
});

test("rejects an invalid condition branch handle", () => {
  const graph = structuredClone(validGraph);
  graph.edges[1].sourceHandle = "maybe";

  assert.ok(
    validateWorkflowGraph(graph).some((error) =>
      error.includes('must be "true" or "false"'),
    ),
  );
});

test("rejects a directed cycle", () => {
  const graph = structuredClone(validGraph);
  graph.edges.push({
    id: "edge-cycle",
    source: "task-1",
    target: "trigger-1",
  });

  assert.ok(
    validateWorkflowGraph(graph).some((error) =>
      error.includes("directed cycles"),
    ),
  );
});

test("rejects non-finite node positions", () => {
  const graph = structuredClone(validGraph);
  graph.nodes[0].position.x = Number.NaN;

  assert.ok(
    validateWorkflowGraph(graph).some((error) =>
      error.includes("position.x"),
    ),
  );
});


test("rejects an unsupported graph version", () => {
  const graph = structuredClone(validGraph);
  graph.version = 2;

  assert.ok(
    validateWorkflowGraph(graph).some((error) =>
      error.includes("version must be 1"),
    ),
  );
});

test("rejects a graph with no trigger", () => {
  const graph = structuredClone(validGraph);
  graph.nodes = graph.nodes.filter((node) => node.type !== "trigger");

  assert.ok(
    validateWorkflowGraph(graph).some((error) =>
      error.includes("exactly one trigger"),
    ),
  );
});

test("rejects a graph with multiple triggers", () => {
  const graph = structuredClone(validGraph);
  graph.nodes.push({
    id: "trigger-2",
    type: "trigger",
    position: { x: 800, y: 100 },
    data: { type: "trigger", label: "Second trigger" },
  });

  assert.ok(
    validateWorkflowGraph(graph).some((error) =>
      error.includes("exactly one trigger"),
    ),
  );
});

test("rejects a condition missing its true branch", () => {
  const graph = structuredClone(validGraph);
  graph.edges = graph.edges.filter((edge) => edge.id !== "edge-2");

  assert.ok(
    validateWorkflowGraph(graph).some((error) =>
      error.includes("missing its true branch"),
    ),
  );
});

test("rejects a condition missing its false branch", () => {
  const graph = structuredClone(validGraph);
  graph.edges = graph.edges.filter((edge) => edge.id !== "edge-3");

  assert.ok(
    validateWorkflowGraph(graph).some((error) =>
      error.includes("missing its false branch"),
    ),
  );
});


