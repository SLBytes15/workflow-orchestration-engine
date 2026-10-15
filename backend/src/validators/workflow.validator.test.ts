import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateCreateWorkflow,
  validateUpdateWorkflow,
} from "./workflow.validator";

describe("validateCreateWorkflow", () => {


it("rejects a client-supplied status during creation", () => {
  const result = validateCreateWorkflow({
    name: "Order Processing",
    status: "active",
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("status")));
});

  

it("accepts a valid workflow and trims editable fields", () => {
  const result = validateCreateWorkflow({
    name: "  Order Processing  ",
    description: "  Process an order  ",
    graph: validGraph,
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.data, {
    name: "Order Processing",
    description: "Process an order",
    graph: validGraph,
  });
});






  it("rejects a missing name", () => {
    const result = validateCreateWorkflow({});

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("name")));
  });

  it("rejects an invalid status", () => {
    const result = validateCreateWorkflow({
      name: "Order Processing",
      status: "deleted",
    });

    assert.equal(result.valid, false);
  });

  it("rejects client-supplied tenantId", () => {
    const result = validateCreateWorkflow({
      name: "Order Processing",
      tenantId: "another-tenant",
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("tenantId")));
  });

  it("rejects client-supplied version", () => {
    const result = validateCreateWorkflow({
      name: "Order Processing",
      version: 99,
    });

    assert.equal(result.valid, false);
  });

  it("rejects a non-object body", () => {
    const result = validateCreateWorkflow(null);

    assert.equal(result.valid, false);
  });
});


describe("validateUpdateWorkflow", () => {
  it("accepts and trims editable fields", () => {
    const result = validateUpdateWorkflow({
      name: "  Updated workflow  ",
      description: "  New description  ",
    });

    assert.equal(result.valid, true);
    assert.deepEqual(result.data, {
      name: "Updated workflow",
      description: "New description",
    });
  });

  it("accepts an update containing only a description", () => {
    const result = validateUpdateWorkflow({
      description: "Updated description",
    });

    assert.equal(result.valid, true);
    assert.deepEqual(result.data, {
      description: "Updated description",
    });
  });

  it("rejects an empty update", () => {
    const result = validateUpdateWorkflow({});

    assert.equal(result.valid, false);
  });

  it("rejects status changes", () => {
    const result = validateUpdateWorkflow({
      status: "paused",
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("status")));
  });

  it("rejects tenantId and version", () => {
    const result = validateUpdateWorkflow({
      tenantId: "tenant-002",
      version: 5,
    });

    assert.equal(result.valid, false);
  });

  it("rejects unknown fields", () => {
    const result = validateUpdateWorkflow({
      isAdmin: true,
    });

    assert.equal(result.valid, false);
  });

  it("rejects an invalid name", () => {
    const result = validateUpdateWorkflow({
      name: "   ",
    });

    assert.equal(result.valid, false);
  });

  it("rejects an invalid description", () => {
    const result = validateUpdateWorkflow({
      description: 123,
    });

    assert.equal(result.valid, false);
  });

it("rejects a missing graph", () => {
  const result = validateCreateWorkflow({
    name: "Order Processing",
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("graph")));
});

it("rejects an invalid graph", () => {
  const result = validateCreateWorkflow({
    name: "Order Processing",
    graph: {
      version: 1,
      nodes: [],
      edges: [],
    },
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("trigger")));
});

});


const validGraph = {
  version: 1 as const,
  nodes: [
    {
      id: "trigger-1",
      type: "trigger" as const,
      position: { x: 100, y: 100 },
      data: { type: "trigger" as const, label: "Order created" },
    },
    {
      id: "condition-1",
      type: "condition" as const,
      position: { x: 350, y: 100 },
      data: { type: "condition" as const, label: "Payment approved?" },
    },
    {
      id: "task-1",
      type: "task" as const,
      position: { x: 600, y: 40 },
      data: { type: "task" as const, label: "Confirm order" },
    },
    {
      id: "task-2",
      type: "task" as const,
      position: { x: 600, y: 200 },
      data: { type: "task" as const, label: "Reject order" },
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
