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
  const listCalls: Types.ObjectId[] = [];

  const dependencies: WorkflowServiceDependencies = {
    async createWorkflowRecord(record) {
      storedRecords.push(record);
      return { ...record, _id: new Types.ObjectId() };
    },

    async findWorkflowRecordsByTenant(tenantId) {
      listCalls.push(tenantId);
      return storedRecords.filter((record) => record.tenantId.equals(tenantId));
    },
  };

  return {
    storedRecords,
    listCalls,
    service: createWorkflowService(dependencies),
  };
}

test("creates a workflow for the supplied tenant and trims its name", async () => {
  const context = setup();
  const tenantId = new Types.ObjectId();

  await context.service.createWorkflow({
    tenantId,
    input: { name: "  Onboarding workflow  " },
  });

  assert.equal(context.storedRecords.length, 1);
  assert.equal(context.storedRecords[0].tenantId, tenantId);
  assert.equal(context.storedRecords[0].name, "Onboarding workflow");
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

test("persists an optional description after trimming", async () => {
  const context = setup();

  await context.service.createWorkflow({
    tenantId: new Types.ObjectId(),
    input: {
      name: "Onboarding workflow",
      description: "  Create a profile  ",
    },
  });

  assert.equal(context.storedRecords[0].description, "Create a profile");
});

test("omits description when it is not supplied", async () => {
  const context = setup();

  await context.service.createWorkflow({
    tenantId: new Types.ObjectId(),
    input: { name: "Onboarding workflow" },
  });

  assert.equal("description" in context.storedRecords[0], false);
});

test("rejects a blank name", async () => {
  const context = setup();

  await assert.rejects(
    context.service.createWorkflow({
      tenantId: new Types.ObjectId(),
      input: { name: "   " },
    }),
    /Workflow name must not be empty/,
  );

  assert.equal(context.storedRecords.length, 0);
});

test("propagates persistence errors", async () => {
  const expectedError = new Error("Database unavailable");

  const dependencies: WorkflowServiceDependencies = {
    async createWorkflowRecord() {
      throw expectedError;
    },
    async findWorkflowRecordsByTenant() {
      return [];
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

test("lists workflows only for the supplied tenant", async () => {
  const context = setup();
  const tenantA = new Types.ObjectId();
  const tenantB = new Types.ObjectId();

  await context.service.createWorkflow({
    tenantId: tenantA,
    input: { name: "Tenant A workflow" },
  });

  await context.service.createWorkflow({
    tenantId: tenantB,
    input: { name: "Tenant B workflow" },
  });

  const result = await context.service.listWorkflows(tenantA);

  assert.equal(context.listCalls.length, 1);
  assert.equal(context.listCalls[0], tenantA);
  assert.equal(result.length, 1);
  assert.equal((result[0] as CreatedWorkflow).name, "Tenant A workflow");
});
