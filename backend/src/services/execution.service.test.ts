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
  graph: { nodes: [], edges: [] },
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
    deleteExecution: async () => ({ deletedCount: 1 }),
    enqueueExecution: async () => true,
    findExecution: async () => ({ _id: executionId, tenantId }),
    findHistory: async () => [],
    ...overrides,
  };
}

test("creates an execution snapshot for the trusted tenant", async () => {
  let receivedTenant: Types.ObjectId | undefined;
  let savedRecord: Record<string, unknown> | undefined;

  const service = createExecutionService(makeDependencies({
    findWorkflow: async (tenant, id) => {
      receivedTenant = tenant;
      assert.equal(String(id), String(workflowId));
      return workflow;
    },
    createExecution: async (record) => {
      savedRecord = record;
      return { ...record, _id: executionId, createdAt: new Date() };
    },
  }));

  const result = await service.startExecution(tenantId, String(workflowId));

  assert.equal(String(receivedTenant), String(tenantId));
  assert.equal(result.status, "queued");
  assert.equal(result.workflowVersion, 3);
  assert.deepEqual(savedRecord?.graphSnapshot, workflow.graph);
});

test("returns 503 and removes the record when no queue accepts it", async () => {
  let deleted = false;

  const service = createExecutionService(makeDependencies({
    enqueueExecution: async () => false,
    deleteExecution: async (tenant, id) => {
      assert.equal(String(tenant), String(tenantId));
      assert.equal(String(id), String(executionId));
      deleted = true;
      return { deletedCount: 1 };
    },
  }));

  await assert.rejects(
    service.startExecution(tenantId, String(workflowId)),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.statusCode === 503 &&
      error.code === "EXECUTION_QUEUE_UNAVAILABLE",
  );

  assert.equal(deleted, true);
});

test("does not create an execution for a workflow outside the tenant scope", async () => {
  let created = false;

  const service = createExecutionService(makeDependencies({
    findWorkflow: async (tenant) => {
      assert.equal(String(tenant), String(otherTenantId));
      return null;
    },
    createExecution: async (record) => {
      created = true;
      return record;
    },
  }));

  await assert.rejects(
    service.startExecution(otherTenantId, String(workflowId)),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.statusCode === 404 &&
      error.code === "WORKFLOW_NOT_FOUND",
  );

  assert.equal(created, false);
});

test("scopes execution lookup to the supplied tenant", async () => {
  const service = createExecutionService(makeDependencies({
    findExecution: async (tenant, id) => {
      assert.equal(String(tenant), String(otherTenantId));
      assert.equal(String(id), String(executionId));
      return null;
    },
  }));

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
      error instanceof ExecutionServiceError &&
      error.statusCode === 400,
  );

  await assert.rejects(
    service.listExecutions(tenantId, String(workflowId), 101, undefined),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.statusCode === 400,
  );
});

test("paginates history and returns a cursor when more records exist", async () => {
  const records = [
    { _id: new Types.ObjectId("000000000000000000000003") },
    { _id: new Types.ObjectId("000000000000000000000002") },
    { _id: new Types.ObjectId("000000000000000000000001") },
  ];

  const service = createExecutionService(makeDependencies({
    findHistory: async (tenant, id, limit, cursor) => {
      assert.equal(String(tenant), String(tenantId));
      assert.equal(String(id), String(workflowId));
      assert.equal(limit, 2);
      assert.equal(cursor, undefined);
      return records;
    },
  }));

  const result = await service.listExecutions(
    tenantId,
    String(workflowId),
    2,
    undefined,
  );

  assert.equal(result.executions.length, 2);
  assert.equal(result.pagination.hasMore, true);
  assert.equal(
    result.pagination.nextCursor,
    "000000000000000000000002",
  );
});
