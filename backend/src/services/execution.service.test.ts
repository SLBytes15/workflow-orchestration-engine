import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import {
  createExecutionService,
  ExecutionServiceError,
  type ExecutionServiceDependencies,
} from "./execution.service";

const tenantId = new Types.ObjectId();
const otherTenantId = new Types.ObjectId();
const workflowId = new Types.ObjectId();
const executionId = new Types.ObjectId();

const workflow = {
  _id: workflowId,
  tenantId,
  version: 3,
  graph: {
    version: 1 as const,
    nodes: [
      {
        id: "trigger-1",
        type: "trigger" as const,
        position: { x: 0, y: 0 },
        data: { type: "trigger" as const, label: "Start" },
      },
    ],
    edges: [],
  },
};

const conditionalWorkflow = {
  ...workflow,
  graph: {
    version: 1 as const,
    nodes: [
      {
        id: "trigger-1",
        type: "trigger" as const,
        position: { x: 0, y: 0 },
        data: { type: "trigger" as const, label: "Start" },
      },
      {
        id: "condition-1",
        type: "condition" as const,
        position: { x: 100, y: 0 },
        data: {
          type: "condition" as const,
          label: "Payment approved?",
          config: {
            type: "clause" as const,
            clause: {
              left: "approved",
              op: "equals" as const,
              right: true,
            },
          },
        },
      },
      {
        id: "task-true",
        type: "task" as const,
        position: { x: 200, y: -50 },
        data: { type: "task" as const, label: "Approved path" },
      },
      {
        id: "task-false",
        type: "task" as const,
        position: { x: 200, y: 50 },
        data: { type: "task" as const, label: "Rejected path" },
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


function makeDependencies(
  overrides: Partial<ExecutionServiceDependencies> = {},
): ExecutionServiceDependencies {
  return {
    findWorkflow: async () => workflow,
    createExecution: async (record) => ({
      ...record,
      _id: executionId,
      createdAt: new Date("2026-10-17T12:00:00.000Z"),
    }),
    updateExecution: async (_tenant, _id, _expectedStatus, update) => ({
      _id: executionId,
      tenantId,
      workflowId,
      workflowVersion: 3,
      graphSnapshot: workflow.graph,
      ...update,
    }),
    findExecution: async () => ({ _id: executionId, tenantId }),
    findHistory: async () => [],
    ...overrides,
  };
}

test("executes and persists the final execution for the trusted tenant", async () => {
  const updates: Array<{
    tenant: Types.ObjectId;
    id: Types.ObjectId;
    expectedStatus: string;
    update: Record<string, unknown>;
  }> = [];


  const service = createExecutionService(
    makeDependencies({
      findWorkflow: async () => conditionalWorkflow,
      updateExecution: async (tenant, id, expectedStatus, update) => {
        updates.push({
          tenant,
          id,
          expectedStatus,
          update: update as Record<string, unknown>,
        });

        return {
          _id: executionId,
          tenantId: tenant,
          workflowId,
          workflowVersion: 3,
          graphSnapshot: conditionalWorkflow.graph,
          ...update,
        };
      },
    }),
  );

const input = { approved: true };

const result = await service.startExecution(
  tenantId,
  String(workflowId),
  input,
);

  assert.equal(String(result.tenantId), String(tenantId));
  assert.equal(result.status, "completed");
  assert.equal(result.workflowVersion, 3);
  assert.deepEqual(result.nodeResults, [
    { nodeId: "trigger-1", status: "completed" },
    {
      nodeId: "condition-1",
      status: "completed",
      output: { result: true },
    },
    { nodeId: "task-true", status: "completed" },
  ]);

  assert.equal(updates.length, 2);
  assert.equal(updates[0].expectedStatus, "queued");
  assert.equal(updates[0].update.status, "running");
  assert.equal(updates[1].expectedStatus, "running");
  assert.equal(updates[1].update.status, "completed");

  for (const update of updates) {
    assert.equal(String(update.tenant), String(tenantId));
    assert.equal(String(update.id), String(executionId));
  }
});


test("persists a failed execution when the graph is invalid", async () => {
  const invalidWorkflow = {
    ...workflow,
    graph: { version: 1 as const, nodes: [], edges: [] },
  };

  const updates: Array<Record<string, unknown>> = [];

  const service = createExecutionService(
    makeDependencies({
      findWorkflow: async () => invalidWorkflow,
      updateExecution: async (_tenant, _id, _expectedStatus, update) => {
        updates.push(update as Record<string, unknown>);

        return {
          _id: executionId,
          tenantId,
          workflowId,
          workflowVersion: 3,
          graphSnapshot: invalidWorkflow.graph,
          ...update,
        };
      },
    }),
  );

  const result = await service.startExecution(tenantId, String(workflowId));

  assert.equal(result.status, "failed");
  assert.equal((result.error as { code: string }).code, "INVALID_GRAPH");
  assert.ok(result.completedAt);

  assert.equal(updates.length, 2);
  assert.equal(updates[0].status, "running");
  assert.equal(updates[1].status, "failed");
});

test("does not create an execution for a workflow outside the tenant scope", async () => {
  let created = false;

  const service = createExecutionService(
    makeDependencies({
      findWorkflow: async (tenant) => {
        assert.equal(String(tenant), String(otherTenantId));
        return null;
      },
      createExecution: async (record) => {
        created = true;
        return record;
      },
    }),
  );

  await assert.rejects(
    service.startExecution(otherTenantId, String(workflowId)),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.statusCode === 404 &&
      error.code === "WORKFLOW_NOT_FOUND",
  );

  assert.equal(created, false);
});

test("returns an error if the running state cannot be persisted", async () => {
  const service = createExecutionService(
    makeDependencies({
      updateExecution: async () => null,
    }),
  );

  await assert.rejects(
    service.startExecution(tenantId, String(workflowId)),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.statusCode === 500 &&
      error.code === "EXECUTION_STATE_UPDATE_FAILED",
  );
});

test("returns an error if terminal results cannot be persisted", async () => {
  let calls = 0;

  const service = createExecutionService(
    makeDependencies({
      updateExecution: async (_tenant, _id, _expectedStatus, update) => {
        calls += 1;
        if (calls === 1) {
          return { _id: executionId, status: "running" };
        }
        return null;
      },
    }),
  );

  await assert.rejects(
    service.startExecution(tenantId, String(workflowId)),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.statusCode === 500 &&
      error.code === "EXECUTION_RESULT_PERSISTENCE_FAILED",
  );
});

test("scopes execution lookup to the supplied tenant", async () => {
  const service = createExecutionService(
    makeDependencies({
      findExecution: async (tenant, id) => {
        assert.equal(String(tenant), String(otherTenantId));
        assert.equal(String(id), String(executionId));
        return null;
      },
    }),
  );

  await assert.rejects(
    service.getExecution(otherTenantId, String(executionId)),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.statusCode === 404 &&
      error.code === "EXECUTION_NOT_FOUND",
  );
});

test("rejects malformed IDs and invalid history limits", async () => {
  const service = createExecutionService(makeDependencies());

  await assert.rejects(
    service.getExecution(tenantId, "not-an-id"),
    (error: unknown) =>
      error instanceof ExecutionServiceError && error.statusCode === 400,
  );

  await assert.rejects(
    service.listExecutions(tenantId, String(workflowId), 101, undefined),
    (error: unknown) =>
      error instanceof ExecutionServiceError && error.statusCode === 400,
  );
});

test("paginates history and returns a cursor when more records exist", async () => {
  const records = [
    { _id: new Types.ObjectId("000000000000000000000003") },
    { _id: new Types.ObjectId("000000000000000000000002") },
    { _id: new Types.ObjectId("000000000000000000000001") },
  ];

  const service = createExecutionService(
    makeDependencies({
      findHistory: async (tenant, id, limit, cursor) => {
        assert.equal(String(tenant), String(tenantId));
        assert.equal(String(id), String(workflowId));
        assert.equal(limit, 2);
        assert.equal(cursor, undefined);
        return records;
      },
    }),
  );

  const result = await service.listExecutions(
    tenantId,
    String(workflowId),
    2,
    undefined,
  );

  assert.equal(result.executions.length, 2);
  assert.equal(result.pagination.hasMore, true);
  assert.equal(result.pagination.nextCursor, "000000000000000000000002");
});

test("rejects an invalid history cursor", async () => {
  const service = createExecutionService(makeDependencies());

  await assert.rejects(
    service.listExecutions(
      tenantId,
      String(workflowId),
      20,
      "not-an-object-id",
    ),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.statusCode === 400 &&
      error.code === "VALIDATION_ERROR",
  );
});

test("rejects fractional history limits", async () => {
  const service = createExecutionService(makeDependencies());

  await assert.rejects(
    service.listExecutions(tenantId, String(workflowId), 1.5, undefined),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.statusCode === 400 &&
      error.code === "VALIDATION_ERROR",
  );
});

test("returns no next cursor when history has no additional records", async () => {
  const service = createExecutionService(
    makeDependencies({
      findHistory: async () => [{ _id: executionId }],
    }),
  );

  const result = await service.listExecutions(
    tenantId,
    String(workflowId),
    2,
    undefined,
  );

  assert.equal(result.executions.length, 1);
  assert.equal(result.pagination.hasMore, false);
  assert.equal(result.pagination.nextCursor, null);
});
