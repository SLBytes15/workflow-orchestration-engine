import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateWorkflowGraph } from "../src/graphValidation";

type TestEdge = { id: string; source: string; target: string; sourceHandle?: string };
type TestNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: { type: string; label: string };
};

function graph(overrides: Record<string, unknown> = {}) {
  const nodes: TestNode[] = [
    { id: "trigger-1", type: "trigger", position: { x: 250, y: 50 }, data: { type: "trigger", label: "Order created" } },
    { id: "condition-1", type: "condition", position: { x: 250, y: 180 }, data: { type: "condition", label: "Payment method" } },
    { id: "task-1", type: "task", position: { x: 80, y: 330 }, data: { type: "task", label: "Charge" } },
    { id: "task-2", type: "task", position: { x: 420, y: 330 }, data: { type: "task", label: "Review" } },
  ];

  const edges: TestEdge[] = [
    { id: "e1", source: "trigger-1", target: "condition-1" },
    { id: "e2", source: "condition-1", sourceHandle: "true", target: "task-1" },
    { id: "e3", source: "condition-1", sourceHandle: "false", target: "task-2" },
  ];

  return { version: 1, nodes, edges, ...overrides } as {
    version: number;
    nodes: TestNode[];
    edges: TestEdge[];
  };
}

describe("validateWorkflowGraph", () => {
  it("accepts the default canvas payload", () => {
    assert.deepEqual(validateWorkflowGraph(graph()), []);
  });

  it("rejects a version other than 1", () => {
    const errors = validateWorkflowGraph(graph({ version: 2 }));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /version must be 1/);
  });

  it("rejects a condition missing its false branch", () => {
    const input = graph();
    input.edges = input.edges.filter((edge) => edge.id !== "e3");
    assert.ok(
      validateWorkflowGraph(input).some((error) =>
        /missing its false branch/.test(error),
      ),
    );
  });

  it("rejects a newly added condition node with no branches", () => {
    const input = graph();
    input.nodes.push({
      id: "condition-2",
      type: "condition",
      position: { x: 250, y: 420 },
      data: { type: "condition", label: "New condition" },
    });

    const errors = validateWorkflowGraph(input);
    assert.ok(errors.some((error) => /condition-2.*true branch/.test(error)));
    assert.ok(errors.some((error) => /condition-2.*false branch/.test(error)));
  });

  it("rejects a second trigger node", () => {
    const input = graph();
    input.nodes.push({
      id: "trigger-2",
      type: "trigger",
      position: { x: 500, y: 50 },
      data: { type: "trigger", label: "Second" },
    });
    assert.ok(
      validateWorkflowGraph(input).some((error) =>
        /exactly one trigger/.test(error),
      ),
    );
  });

  it("rejects an edge whose target does not exist", () => {
    const input = graph();
    input.edges.push({ id: "e4", source: "task-2", target: "ghost" });
    assert.ok(
      validateWorkflowGraph(input).some((error) =>
        /missing target node/.test(error),
      ),
    );
  });

  it("rejects a cycle", () => {
    const input = graph();
    input.edges.push({ id: "e5", source: "task-1", target: "condition-1" });
    assert.ok(
      validateWorkflowGraph(input).some((error) => /acyclic/.test(error)),
    );
  });

  it("rejects a condition edge with a handle other than true or false", () => {
    const input = graph();
    input.edges[1] = { id: "e2", source: "condition-1", sourceHandle: "yes", target: "task-1" };

    const errors = validateWorkflowGraph(input);
    assert.ok(errors.some((error) => /sourceHandle "true" or "false"/.test(error)));
    assert.ok(errors.some((error) => /missing its true branch/.test(error)));
  });

  it("rejects a duplicate node id", () => {
    const input = graph();
    input.nodes.push({
      id: "task-1",
      type: "task",
      position: { x: 0, y: 0 },
      data: { type: "task", label: "Duplicate" },
    });
    assert.ok(
      validateWorkflowGraph(input).some((error) =>
        /duplicate node id/.test(error),
      ),
    );
  });

  it("rejects a non-finite position", () => {
    const input = graph();
    input.nodes[0].position = { x: Number.NaN, y: 50 };
    assert.ok(
      validateWorkflowGraph(input).some((error) => /finite position/.test(error)),
    );
  });
});
