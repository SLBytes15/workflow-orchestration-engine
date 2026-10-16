import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import {
  createWorkflowService,
  type CreatedWorkflow,
  type WorkflowServiceDependencies,
} from "./workflow.service";
import type { WorkflowGraph } from "../validators/workflow-graph.validator";

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


const validGraph: WorkflowGraph = {
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
      data: { type: "condition", label: "Order valid?" },
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



test("creates a workflow for the supplied tenant and trims its name", async () => {
  const context = setup();
  const tenantId = new Types.ObjectId();

  await context.service.createWorkflow({
    tenantId,
    input: {
      name: "  Order Processing  ",
      description: "Process an order",
      graph: validGraph,
    },
  });


  assert.equal(context.storedRecords.length, 1);
  assert.equal(context.storedRecords[0].tenantId, tenantId);
  assert.equal(context.storedRecords[0].name, "Order Processing");
  assert.equal(context.storedRecords[0].description, "Process an order");
  assert.deepEqual(context.storedRecords[0].graph, validGraph);
});


test("always assigns draft status and version one", async () => {
  const context = setup();

  await context.service.createWorkflow({
    tenantId: new Types.ObjectId(),
    input: { name: "Onboarding workflow", graph: validGraph },
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
      graph: validGraph,
    },
  });

  assert.equal(context.storedRecords[0].description, "Create a profile");
});

test("omits description when it is not supplied", async () => {
  const context = setup();

  await context.service.createWorkflow({
    tenantId: new Types.ObjectId(),
    input: { name: "Onboarding workflow", graph: validGraph },
  });

  assert.equal("description" in context.storedRecords[0], false);
});

test("rejects a blank name", async () => {
  const context = setup();

  await assert.rejects(
    context.service.createWorkflow({
      tenantId: new Types.ObjectId(),
      input: { name: "   ", graph: validGraph },
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
      input: { name: "Onboarding workflow", graph: validGraph },
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
    input: { name: "Tenant A workflow", graph: validGraph },
  });

  await context.service.createWorkflow({
    tenantId: tenantB,
    input: { name: "Tenant B workflow", graph: validGraph },
  });

  const result = await context.service.listWorkflows(tenantA);

  assert.equal(context.listCalls.length, 1);
  assert.equal(context.listCalls[0], tenantA);
  assert.equal(result.length, 1);
  assert.equal((result[0] as CreatedWorkflow).name, "Tenant A workflow");
});
