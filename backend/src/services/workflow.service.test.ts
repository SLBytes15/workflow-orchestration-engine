import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import {
  createWorkflowService,
  type CreatedWorkflow,
  type WorkflowServiceDependencies,
} from "./workflow.service";

function setup() {
  const storedRecords: CreatedWorkflow[] = [];

  const dependencies: WorkflowServiceDependencies = {
    async createWorkflowRecord(record) {
      storedRecords.push(record);
      return { ...record, _id: new Types.ObjectId() };
    },
  };

  return {
    storedRecords,
    service: createWorkflowService(dependencies),
  };
}

test("creates a workflow for the supplied tenant", async () => {
  const context = setup();
  const tenantId = new Types.ObjectId();

  const result = await context.service.createWorkflow({
    tenantId,
    input: { name: "  Onboarding workflow  " },
  });

  assert.equal(context.storedRecords.length, 1);
  assert.equal(context.storedRecords[0].tenantId, tenantId);
  assert.equal(context.storedRecords[0].name, "  Onboarding workflow  ");
  assert.ok(result);
});

test("always assigns draft status and version one", async () => {
  const context = setup();

  await context.service.createWorkflow({
    tenantId: new Types.ObjectId(),
    input: { name: "Onboarding workflow" },
  });

  assert.equal(context.storedRecords[0].status, "draft");
  assert.equal(context.storedRecords[0].version, 1);
});

test("persists an optional description", async () => {
  const context = setup();

  await context.service.createWorkflow({
    tenantId: new Types.ObjectId(),
    input: {
      name: "Onboarding workflow",
      description: "Create an account and configure a profile",
    },
  });

  assert.equal(
    context.storedRecords[0].description,
    "Create an account and configure a profile",
  );
});

test("does not include description when it is omitted", async () => {
  const context = setup();

  await context.service.createWorkflow({
    tenantId: new Types.ObjectId(),
    input: { name: "Onboarding workflow" },
  });

  assert.equal("description" in context.storedRecords[0], false);
});

test("propagates persistence errors", async () => {
  const expectedError = new Error("Database unavailable");

  const dependencies: WorkflowServiceDependencies = {
    async createWorkflowRecord() {
      throw expectedError;
    },
  };

  const service = createWorkflowService(dependencies);

  await assert.rejects(
    service.createWorkflow({
      tenantId: new Types.ObjectId(),
      input: { name: "Onboarding workflow" },
    }),
    (error: unknown) => error === expectedError,
  );
});
