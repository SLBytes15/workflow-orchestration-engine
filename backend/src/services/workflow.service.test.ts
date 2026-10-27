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
  const graphUpdates: Array<{
    tenantId: Types.ObjectId;
    workflowId: Types.ObjectId;
    graph: WorkflowGraph;
  }> = [];
  const workflowDeletes: Array<{
    tenantId: Types.ObjectId;
    workflowId: Types.ObjectId;
  }> = [];
  const workflowActivations: Array<{
    tenantId: Types.ObjectId;
    workflowId: Types.ObjectId;
  }> = [];

  const dependencies: WorkflowServiceDependencies = {
    async createWorkflowRecord(record) {
      const created = { ...record, _id: new Types.ObjectId() };
      storedRecords.push(created as unknown as CreatedWorkflow);
      return created;
    },

    async findWorkflowRecordsByTenant(tenantId) {
      listCalls.push(tenantId);
      return storedRecords.filter((record) => record.tenantId.equals(tenantId));
    },

    async updateWorkflowGraph(tenantId, workflowId, graph) {
      graphUpdates.push({ tenantId, workflowId, graph });
      return { tenantId, _id: workflowId, graph };
    },

    async deleteWorkflow(tenantId, workflowId) {
      workflowDeletes.push({ tenantId, workflowId });
      return { tenantId, _id: workflowId };
    },

    async activateWorkflowRecord(tenantId, workflowId, expectedVersion) {
      workflowActivations.push({ tenantId, workflowId });
      const record = storedRecords.find(
        (r) => r.tenantId.equals(tenantId) && (r as any)._id?.equals(workflowId),
      );
      if (!record) return null;
      if (
        expectedVersion !== undefined &&
        (record as any).version !== expectedVersion
      ) {
        return null;
      }
      if (record.status === "draft" || (record.status as string) === "active") {
        (record as any).status = "active";
        return record;
      }
      return null;
    },

    async findWorkflowRecordById(tenantId, workflowId) {
      const record = storedRecords.find(
        (r) => r.tenantId.equals(tenantId) && (r as any)._id?.equals(workflowId),
      );
      return record ?? null;
    },
  };

  return {
    storedRecords,
    listCalls,
    graphUpdates,
    workflowDeletes,
    workflowActivations,
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
    async updateWorkflowGraph() {
      return null;
    },
    async deleteWorkflow() {
      return null;
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

test("updates only the graph for the specified workflow and tenant", async () => {
  const context = setup();
  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const graph: WorkflowGraph = {
    ...validGraph,
    nodes: validGraph.nodes.map((node) =>
      node.type === "condition"
        ? {
            ...node,
            data: {
              ...node.data,
              config: {
                type: "clause",
                clause: { left: "approved", op: "equals", right: true },
              },
            },
          }
        : node,
    ),
  };

  const result = await context.service.updateWorkflowGraph(
    tenantId,
    workflowId.toString(),
    graph,
  );

  assert.deepEqual(context.graphUpdates, [{ tenantId, workflowId, graph }]);
  assert.deepEqual(result, { tenantId, _id: workflowId, graph });
});

test("rejects malformed workflow IDs without attempting a graph update", async () => {
  const context = setup();

  assert.equal(
    await context.service.updateWorkflowGraph(
      new Types.ObjectId(),
      "not-an-object-id",
      validGraph,
    ),
    null,
  );
  assert.deepEqual(context.graphUpdates, []);
});

test("rejects invalid workflow graphs without attempting an update", async () => {
  const context = setup();
  const invalidGraph: WorkflowGraph = {
    ...validGraph,
    nodes: validGraph.nodes.map((node) =>
      node.type === "condition"
        ? {
            ...node,
            data: {
              ...node.data,
              config: undefined,
            },
          }
        : node,
    ),
  };

  await assert.rejects(
    context.service.updateWorkflowGraph(
      new Types.ObjectId(),
      new Types.ObjectId().toString(),
      invalidGraph,
    ),
    /The workflow graph is invalid/,
  );
  assert.deepEqual(context.graphUpdates, []);
});

test("deletes a workflow by both its ID and authenticated tenant", async () => {
  const context = setup();
  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();

  const result = await context.service.deleteWorkflow(
    tenantId,
    workflowId.toString(),
  );

  assert.deepEqual(context.workflowDeletes, [{ tenantId, workflowId }]);
  assert.deepEqual(result, { tenantId, _id: workflowId });
});

test("returns null when a graph update cannot find a workflow for the tenant", async () => {
  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const graph = structuredClone(validGraph);
  const conditionNode = graph.nodes.find((node) => node.type === "condition");
  assert.ok(conditionNode);
  conditionNode.data.config = {
    type: "clause",
    clause: { left: "approved", op: "equals", right: true },
  };
  const dependencies: WorkflowServiceDependencies = {
    async createWorkflowRecord(record) {
      return record;
    },
    async findWorkflowRecordsByTenant() {
      return [];
    },
    async updateWorkflowGraph(requestedTenantId, requestedWorkflowId) {
      assert.ok(requestedTenantId.equals(tenantId));
      assert.ok(requestedWorkflowId.equals(workflowId));
      return null;
    },
  };

  const result = await createWorkflowService(dependencies).updateWorkflowGraph(
    tenantId,
    workflowId.toString(),
    graph,
  );

  assert.equal(result, null);
});

test("returns null when deletion cannot find a workflow for the tenant", async () => {
  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const dependencies: WorkflowServiceDependencies = {
    async createWorkflowRecord(record) {
      return record;
    },
    async findWorkflowRecordsByTenant() {
      return [];
    },
    async deleteWorkflow(requestedTenantId, requestedWorkflowId) {
      assert.ok(requestedTenantId.equals(tenantId));
      assert.ok(requestedWorkflowId.equals(workflowId));
      return null;
    },
  };

  const result = await createWorkflowService(dependencies).deleteWorkflow(
    tenantId,
    workflowId.toString(),
  );

  assert.equal(result, null);
});

test("rejects malformed workflow IDs without attempting deletion", async () => {
  const context = setup();

  assert.equal(
    await context.service.deleteWorkflow(new Types.ObjectId(), "invalid"),
    null,
  );
  assert.deepEqual(context.workflowDeletes, []);
});

test("activates a draft workflow and updates its status to active", async () => {
  const context = setup();
  const tenantId = new Types.ObjectId();

  const created = (await context.service.createWorkflow({
    tenantId,
    input: { name: "Draft workflow", graph: validGraph },
  })) as { _id: Types.ObjectId; status: string };

  assert.equal(created.status, "draft");

  const result = await context.service.activateWorkflow(
    tenantId,
    created._id.toString(),
  );

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal((result.workflow as { status: string }).status, "active");
  }
  assert.equal(context.workflowActivations.length, 1);
});

test("repeated activation of an active workflow succeeds idempotently", async () => {
  const context = setup();
  const tenantId = new Types.ObjectId();

  const created = (await context.service.createWorkflow({
    tenantId,
    input: { name: "Draft workflow", graph: validGraph },
  })) as { _id: Types.ObjectId; status: string };

  const firstActivation = await context.service.activateWorkflow(
    tenantId,
    created._id.toString(),
  );
  assert.equal(firstActivation.outcome, "success");

  const secondActivation = await context.service.activateWorkflow(
    tenantId,
    created._id.toString(),
  );
  assert.equal(secondActivation.outcome, "success");
  if (secondActivation.outcome === "success") {
    assert.equal(
      (secondActivation.workflow as { status: string }).status,
      "active",
    );
  }
  assert.equal(context.workflowActivations.length, 2);
});

test("rejects malformed workflow IDs without attempting activation", async () => {
  const context = setup();

  const result = await context.service.activateWorkflow(
    new Types.ObjectId(),
    "malformed-id",
  );

  assert.deepEqual(result, { outcome: "not_found" });
  assert.deepEqual(context.workflowActivations, []);
});

test("returns not_found when workflow does not exist", async () => {
  const context = setup();
  const missingId = new Types.ObjectId().toString();

  const result = await context.service.activateWorkflow(
    new Types.ObjectId(),
    missingId,
  );

  assert.deepEqual(result, { outcome: "not_found" });
});

test("returns not_found when attempting to activate another tenant's workflow", async () => {
  const context = setup();
  const tenantA = new Types.ObjectId();
  const tenantB = new Types.ObjectId();

  const created = (await context.service.createWorkflow({
    tenantId: tenantA,
    input: { name: "Tenant A workflow", graph: validGraph },
  })) as { _id: Types.ObjectId; status: string };

  const result = await context.service.activateWorkflow(
    tenantB,
    created._id.toString(),
  );

  assert.deepEqual(result, { outcome: "not_found" });
  assert.equal(created.status, "draft");
});

test("returns invalid_status when attempting to activate a paused workflow", async () => {
  const context = setup();
  const tenantId = new Types.ObjectId();

  const created = (await context.service.createWorkflow({
    tenantId,
    input: { name: "Workflow", graph: validGraph },
  })) as { _id: Types.ObjectId; status: string };

  // Set status directly to paused in storage
  (context.storedRecords[0] as any).status = "paused";

  const result = await context.service.activateWorkflow(
    tenantId,
    created._id.toString(),
  );

  assert.deepEqual(result, {
    outcome: "invalid_status",
    currentStatus: "paused",
  });
});

test("propagates database errors during activation", async () => {
  const expectedError = new Error("Database timeout");
  const dependencies: WorkflowServiceDependencies = {
    async createWorkflowRecord(record) {
      return record;
    },
    async findWorkflowRecordsByTenant() {
      return [];
    },
    async activateWorkflowRecord() {
      throw expectedError;
    },
  };

  const service = createWorkflowService(dependencies);
  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId().toString();

  await assert.rejects(
    service.activateWorkflow(tenantId, workflowId),
    (error: unknown) => error === expectedError,
  );
});

test("handles concurrent activation requests safely without throwing or losing active status", async () => {
  const context = setup();
  const tenantId = new Types.ObjectId();

  const created = (await context.service.createWorkflow({
    tenantId,
    input: { name: "Concurrent workflow", graph: validGraph },
  })) as { _id: Types.ObjectId; status: string };

  const [res1, res2] = await Promise.all([
    context.service.activateWorkflow(tenantId, created._id.toString()),
    context.service.activateWorkflow(tenantId, created._id.toString()),
  ]);

  assert.equal(res1.outcome, "success");
  assert.equal(res2.outcome, "success");
  if (res1.outcome === "success" && res2.outcome === "success") {
    assert.equal((res1.workflow as { status: string }).status, "active");
    assert.equal((res2.workflow as { status: string }).status, "active");
  }
});

test("rejects activation when the stored workflow graph is structurally invalid", async () => {
  const context = setup();
  const tenantId = new Types.ObjectId();

  const created = (await context.service.createWorkflow({
    tenantId,
    input: { name: "Invalid graph workflow", graph: validGraph },
  })) as { _id: Types.ObjectId; status: string };

  // Corrupt the stored graph by removing all nodes
  (context.storedRecords[0] as any).graph = {
    version: 1,
    nodes: [],
    edges: [],
  };

  const result = await context.service.activateWorkflow(
    tenantId,
    created._id.toString(),
  );

  assert.equal(result.outcome, "invalid_graph");
  if (result.outcome === "invalid_graph") {
    assert.ok(result.errors.length > 0);
    assert.ok(
      result.errors.some((err) =>
        err.includes("Graph must contain exactly one trigger node"),
      ),
    );
  }
  assert.equal((context.storedRecords[0] as any).status, "draft");
});

test("rejects activation when the stored workflow condition configuration is invalid", async () => {
  const context = setup();
  const tenantId = new Types.ObjectId();

  const created = (await context.service.createWorkflow({
    tenantId,
    input: { name: "Invalid condition workflow", graph: validGraph },
  })) as { _id: Types.ObjectId; status: string };

  // Corrupt condition node config with an unsupported operator
  const corruptedGraph = JSON.parse(JSON.stringify(validGraph));
  corruptedGraph.nodes[1].data.config.clause.op = "unsupported_operator";
  (context.storedRecords[0] as any).graph = corruptedGraph;

  const result = await context.service.activateWorkflow(
    tenantId,
    created._id.toString(),
  );

  assert.equal(result.outcome, "invalid_graph");
  if (result.outcome === "invalid_graph") {
    assert.ok(
      result.errors.some((err) =>
        err.includes("must contain a supported condition clause"),
      ),
    );
  }
  assert.equal((context.storedRecords[0] as any).status, "draft");
});

test("re-validates and activates safely if workflow version changes concurrently during activation", async () => {
  const context = setup();
  const tenantId = new Types.ObjectId();

  const created = (await context.service.createWorkflow({
    tenantId,
    input: { name: "Version race workflow", graph: validGraph },
  })) as { _id: Types.ObjectId; status: string };

  let firstAttempt = true;
  const originalActivate = context.service;

  // Simulate a concurrent graph update on the first activate call:
  // We can test this by creating a service where activateWorkflowRecord rejects version 1 once
  const dependencies: WorkflowServiceDependencies = {
    async createWorkflowRecord(record) {
      return record;
    },
    async findWorkflowRecordsByTenant() {
      return [];
    },
    async findWorkflowRecordById(_tId, _wId) {
      return {
        _id: created._id,
        tenantId,
        status: "draft",
        version: firstAttempt ? 1 : 2,
        graph: validGraph,
      };
    },
    async activateWorkflowRecord(_tId, _wId, expectedVersion) {
      if (firstAttempt && expectedVersion === 1) {
        // Concurrently incremented to version 2
        firstAttempt = false;
        return null;
      }
      return {
        _id: created._id,
        tenantId,
        status: "active",
        version: expectedVersion,
        graph: validGraph,
      };
    },
  };

  const service = createWorkflowService(dependencies);
  const result = await service.activateWorkflow(tenantId, created._id.toString());

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal((result.workflow as { status: string }).status, "active");
  }
});

test("activates a workflow with a valid event trigger configuration", async () => {
  const context = setup();
  const tenantId = new Types.ObjectId();

  const graphWithEventTrigger: WorkflowGraph = {
    ...validGraph,
    nodes: validGraph.nodes.map((node) =>
      node.type === "trigger"
        ? {
            ...node,
            data: {
              ...node.data,
              config: {
                kind: "event",
                source: "business_events",
                eventName: "order.created",
                filter: { "payload.status": "pending" },
              },
            },
          }
        : node,
    ),
  };

  const created = (await context.service.createWorkflow({
    tenantId,
    input: { name: "Event workflow", graph: graphWithEventTrigger },
  })) as { _id: Types.ObjectId; status: string };

  const result = await context.service.activateWorkflow(
    tenantId,
    created._id.toString(),
  );

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal((result.workflow as { status: string }).status, "active");
  }
});

test("rejects activation when the workflow event trigger configuration has an unapproved source", async () => {
  const context = setup();
  const tenantId = new Types.ObjectId();

  const created = (await context.service.createWorkflow({
    tenantId,
    input: { name: "Event workflow", graph: validGraph },
  })) as { _id: Types.ObjectId; status: string };

  // Mutate trigger config in storage to an unapproved source
  (context.storedRecords[0] as any).graph = {
    ...validGraph,
    nodes: validGraph.nodes.map((node) =>
      node.type === "trigger"
        ? {
            ...node,
            data: {
              ...node.data,
              config: {
                kind: "event",
                source: "unapproved_collection",
                eventName: "order.created",
              },
            },
          }
        : node,
    ),
  };

  const result = await context.service.activateWorkflow(
    tenantId,
    created._id.toString(),
  );

  assert.equal(result.outcome, "invalid_graph");
  if (result.outcome === "invalid_graph") {
    assert.ok(
      result.errors.some((err) =>
        err.includes("Event trigger source must be 'business_events'"),
      ),
    );
  }
  assert.equal((context.storedRecords[0] as any).status, "draft");
});
