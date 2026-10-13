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
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.data, {
    name: "Order Processing",
    description: "Process an order",
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
});
