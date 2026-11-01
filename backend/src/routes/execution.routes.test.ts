import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { Types } from "mongoose";

import { errorHandler } from "../middleware/errorHandler.middleware";
import type { TenantResolver } from "../services/tenantResolver";
import {
  createExecutionRouter,
} from "./execution.routes";
import { ExecutionServiceError } from "../services/execution.service";

const tenantId = new Types.ObjectId();
const otherTenantId = new Types.ObjectId();
const executionId = new Types.ObjectId();
const workflowId = new Types.ObjectId();

let server: Server;
let baseUrl: string;
let receivedTenantId: string | undefined;
let receivedWorkflowId: string | undefined;
let receivedExecutionId: string | undefined;
let receivedLimit: unknown;
let receivedCursor: unknown;
let receivedSummaryOptions: any;
let summaryResult: any;

let mode: "normal" | "execution-error" | "not-found" = "normal";
let historyRecords: Record<string, any>[] = [];

let receivedInput: Record<string, unknown> | undefined;

const resolver: TenantResolver = {
  async resolverTenant(apiKey: string) {
    if (apiKey !== "valid-test-key" && apiKey !== "other-test-key") return null;

    return {
      tenantId: apiKey === "valid-test-key" ? tenantId : otherTenantId,
    } as NonNullable<
      Awaited<ReturnType<TenantResolver["resolverTenant"]>>
    >;
  },
};

const execution: Record<string, any> = {
  _id: executionId,
  tenantId,
  workflowId,
  workflowVersion: 3,
  status: "completed",
  currentNodeId: null,
  nodeResults: [
    { nodeId: "trigger-1", status: "completed" },
  ],
  error: null,
  startedAt: new Date("2026-10-18T10:00:00.000Z"),
  completedAt: new Date("2026-10-18T10:00:01.000Z"),
  createdAt: new Date("2026-10-18T10:00:00.000Z"),
};

const service = {
  async startExecution(
    tenant: Types.ObjectId,
    id: string,
    input: Record<string, unknown> = {},
  ) {
    receivedTenantId = String(tenant);
    receivedWorkflowId = id;
    receivedInput = input;

    if (!/^[a-f\d]{24}$/i.test(id)) {
      throw new ExecutionServiceError(
        400,
        "VALIDATION_ERROR",
        "Invalid workflow ID",
      );
    }

    if (mode === "execution-error") {
      throw new ExecutionServiceError(
        500,
        "EXECUTION_FAILED",
        "Workflow execution failed unexpectedly.",
      );
    }

    if (mode === "not-found") {
      throw new ExecutionServiceError(
        404,
        "WORKFLOW_NOT_FOUND",
        "Workflow not found",
      );
    }

    return execution;
  },

  async getExecution(tenant: Types.ObjectId, id: string) {
    receivedTenantId = String(tenant);
    receivedExecutionId = id;
    if (!/^[a-f\d]{24}$/i.test(id)) {
      throw new ExecutionServiceError(
        400,
        "VALIDATION_ERROR",
        "Invalid execution ID",
      );
    }

    if (mode === "execution-error") {
      throw new Error("private-db-secret internal stack details");
    }

    if (mode === "not-found" || !tenant.equals(tenantId)) {
      throw new ExecutionServiceError(
        404,
        "EXECUTION_NOT_FOUND",
        "Execution not found",
      );
    }

    return execution;
  },

  async listExecutions(
    tenant: Types.ObjectId,
    id: string,
    limit: unknown,
    cursor: unknown,
  ) {
    receivedTenantId = String(tenant);
    receivedWorkflowId = id;
    receivedLimit = limit;
    receivedCursor = cursor;

    if (mode === "not-found") {
      throw new ExecutionServiceError(
        404,
        "WORKFLOW_NOT_FOUND",
        "Workflow not found",
      );
    }

    return {
      executions: tenant.equals(tenantId) ? historyRecords : [],
      pagination: {
        limit: limit === undefined ? 20 : Number(limit),
        hasMore: false,
        nextCursor: null,
      },
    };
  },

  async getExecutionSummary(tenant: Types.ObjectId, options?: Record<string, unknown>) {
    receivedTenantId = String(tenant);
    receivedSummaryOptions = options;

    if (options?.workflowId !== undefined) {
      if (typeof options.workflowId !== "string" || !/^[a-f\d]{24}$/i.test(options.workflowId)) {
        throw new ExecutionServiceError(
          400,
          "VALIDATION_ERROR",
          "Invalid workflow ID",
        );
      }
    }

    if (options?.from !== undefined) {
      if (typeof options.from !== "string" || Number.isNaN(Date.parse(options.from))) {
        throw new ExecutionServiceError(
          400,
          "VALIDATION_ERROR",
          "Invalid 'from' date string",
        );
      }
    }

    if (options?.to !== undefined) {
      if (typeof options.to !== "string" || Number.isNaN(Date.parse(options.to))) {
        throw new ExecutionServiceError(
          400,
          "VALIDATION_ERROR",
          "Invalid 'to' date string",
        );
      }
    }

    if (options?.from && options?.to) {
      if (new Date(options.from as string) > new Date(options.to as string)) {
        throw new ExecutionServiceError(
          400,
          "VALIDATION_ERROR",
          "'from' date cannot be after 'to' date",
        );
      }
    }

    if (mode === "execution-error") {
      throw new Error("database failure");
    }

    return (
      summaryResult ?? {
        summary: {
          total: 10,
          completed: 8,
          failed: 1,
          running: 1,
          queued: 0,
          compensating: 0,
          compensated: 0,
          compensationFailed: 0,
          unsuccessful: 1,
          successRate: 0.8889,
          failureRate: 0.1111,
          avgDurationMs: 1500,
        },
        filter: {
          workflowId: options?.workflowId ?? null,
          from: options?.from ?? null,
          to: options?.to ?? null,
        },
      }
    );
  },
};

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/workflows", createExecutionRouter(resolver, service as any));
  app.use("/api/executions", createExecutionRouter(resolver, service as any));
  app.use(errorHandler);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Could not determine test server address");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

function resetState() {
  receivedTenantId = undefined;
  receivedWorkflowId = undefined;
  receivedExecutionId = undefined;
  receivedLimit = undefined;
  receivedCursor = undefined;
  receivedInput = undefined;
  receivedSummaryOptions = undefined;
  summaryResult = undefined;
  historyRecords = [];
  execution.status = "completed";
  execution.error = null;
  execution.nodeResults = [
    { nodeId: "trigger-1", status: "completed" },
  ];
  mode = "normal";
}

function authHeaders() {
  return { "x-api-key": "valid-test-key" };
}

test("rejects execution requests without an API key", async () => {
  const response = await fetch(
    `${baseUrl}/api/executions/${executionId}`,
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: {
      code: "UNAUTHORIZED",
      message: "A valid API key is required",
    },
  });
});

test("rejects execution requests with an invalid API key", async () => {
  const response = await fetch(
    `${baseUrl}/api/executions/${executionId}`,
    { headers: { "x-api-key": "invalid-test-key" } },
  );

  assert.equal(response.status, 401);
});



test("executes a workflow using the authenticated tenant and forwards input", async () => {
  resetState();

  const input = { approved: true };

  const response = await fetch(
    `${baseUrl}/api/workflows/${workflowId}/executions`,
    {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({ input }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(receivedTenantId, String(tenantId));
  assert.equal(receivedWorkflowId, String(workflowId));

  // Verify the request input reached the service.
  assert.deepEqual(receivedInput, input);

  const body = await response.json();

  assert.equal(body.execution.status, "completed");
  assert.equal(body.execution.workflowVersion, 3);
  assert.deepEqual(body.execution.nodeResults, [
    { nodeId: "trigger-1", status: "completed" },
  ]);
  assert.equal(body.execution.error, null);
  assert.ok(body.execution.completedAt);
});



test("returns 503 when the execution queue is unavailable", async () => {
  resetState();
  mode = "execution-error";

  const response = await fetch(
    `${baseUrl}/api/workflows/${workflowId}/executions`,
    { method: "POST", headers: authHeaders() },
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: {
      code: "EXECUTION_FAILED",
      message: "Workflow execution failed unexpectedly.",
    },
  });
});

test("returns a tenant-scoped execution by ID", async () => {
  resetState();

  const response = await fetch(
    `${baseUrl}/api/executions/${executionId}`,
    { headers: authHeaders() },
  );

  assert.equal(response.status, 200);
  assert.equal(receivedTenantId, String(tenantId));
  assert.equal(receivedExecutionId, String(executionId));

  const body = await response.json();
  assert.equal(body.execution.status, "completed");
});

test("returns not-found for an unavailable execution", async () => {
  resetState();
  mode = "not-found";

  const response = await fetch(
    `${baseUrl}/api/executions/${executionId}`,
    { headers: authHeaders() },
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: {
      code: "EXECUTION_NOT_FOUND",
      message: "Execution not found",
    },
  });
});

test("passes history pagination parameters to the service", async () => {
  resetState();

  const cursor = new Types.ObjectId().toString();
  const response = await fetch(
    `${baseUrl}/api/workflows/${workflowId}/executions?limit=10&cursor=${cursor}`,
    { headers: authHeaders() },
  );

  assert.equal(response.status, 200);
  assert.equal(receivedTenantId, String(tenantId));
  assert.equal(receivedWorkflowId, String(workflowId));
  assert.equal(receivedLimit, "10");
  assert.equal(receivedCursor, cursor);

  const body = await response.json();
  assert.equal(body.pagination.limit, 10);
  assert.equal(body.pagination.hasMore, false);
});

test("returns the service error for a missing workflow", async () => {
  resetState();
  mode = "not-found";

  const response = await fetch(
    `${baseUrl}/api/workflows/${workflowId}/executions`,
    { headers: authHeaders() },
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: {
      code: "WORKFLOW_NOT_FOUND",
      message: "Workflow not found",
    },
  });
});

test("returns 400 for a malformed workflow ID", async () => {
  resetState();
  const response = await fetch(
    `${baseUrl}/api/workflows/not-a-valid-id/executions`,
    { method: "POST", headers: authHeaders() },
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
});

test("returns 400 for a malformed execution ID", async () => {
  resetState();
  const response = await fetch(
    `${baseUrl}/api/executions/not-a-valid-id`,
    { headers: authHeaders() },
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
});

test("does not trust a client-supplied tenantId", async () => {
  resetState();
  const response = await fetch(
    `${baseUrl}/api/workflows/${workflowId}/executions`,
    {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify({ tenantId: new Types.ObjectId().toString() }),
    },
  );
  assert.equal(response.status, 200);
  assert.equal(receivedTenantId, String(tenantId));
});

test("does not expose internal details for unexpected errors", async () => {
  resetState();
  mode = "execution-error";
  const response = await fetch(
    `${baseUrl}/api/executions/${executionId}`,
    { headers: authHeaders() },
  );
  assert.equal(response.status, 500);
  const body = await response.text();
  assert.ok(!body.includes("private-db-secret"));
  assert.ok(!body.includes("stack details"));
  assert.ok(body.includes("INTERNAL_SERVER_ERROR"));
});
test("returns all defined Saga execution statuses and separates original and compensation errors", async () => {
  const originalError = {
    code: "EXECUTION_FAILED",
    message: "The workflow step failed",
    details: { nodeId: "node-1" },
  };
  const compensationError = {
    code: "COMPENSATION_FAILED",
    message: "Rollback failed",
  };

  const cases = [
    { status: "compensating", compensationStatus: "running" },
    { status: "compensated", compensationStatus: "completed" },
    { status: "compensation_failed", compensationStatus: "failed" },
  ];

  for (const item of cases) {
    resetState();
    execution.status = item.status;
    execution.error =
      item.status === "compensation_failed" ? originalError : null;
    execution.nodeResults = [{
      nodeId: "node-1",
      status: "completed",
      compensation: {
        status: item.compensationStatus,
        startedAt: "2026-10-22T10:00:00.000Z",
        completedAt:
          item.compensationStatus === "running"
            ? null
            : "2026-10-22T10:00:01.000Z",
        error:
          item.compensationStatus === "failed"
            ? compensationError
            : null,
      },
    }];

    const response = await fetch(
      `${baseUrl}/api/executions/${executionId}`,
      { headers: authHeaders() },
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.execution.status, item.status);
    assert.equal(
      body.execution.nodeResults[0].compensation.status,
      item.compensationStatus,
    );

    if (item.status === "compensation_failed") {
      assert.deepEqual(body.execution.error, originalError);
      assert.deepEqual(
        body.execution.nodeResults[0].compensation.error,
        compensationError,
      );
      assert.notDeepEqual(
        body.execution.error,
        body.execution.nodeResults[0].compensation.error,
      );
    }
  }
});

test("retrieves legacy execution details without compensation metadata", async () => {
  resetState();
  execution.nodeResults = [
    {
      nodeId: "legacy-task",
      status: "completed",
      output: { ok: true },
    },
  ];

  const response = await fetch(
    `${baseUrl}/api/executions/${executionId}`,
    { headers: authHeaders() },
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.execution.status, "completed");
  assert.deepEqual(body.execution.nodeResults, [
    {
      nodeId: "legacy-task",
      status: "completed",
      output: { ok: true },
    },
  ]);
  assert.equal(
    Object.hasOwn(body.execution.nodeResults[0], "compensation"),
    false,
  );
});

test("returns Saga and legacy records in execution history", async () => {
  resetState();

  historyRecords = [
    {
      ...execution,
      _id: new Types.ObjectId(),
      status: "compensating",
      error: null,
      nodeResults: [{
        nodeId: "task-a",
        status: "completed",
        compensation: {
          status: "running",
          startedAt: new Date("2026-10-22T10:00:00.000Z"),
          completedAt: null,
          error: null,
        },
      }],
    },
    {
      ...execution,
      _id: new Types.ObjectId(),
      status: "compensated",
      error: null,
      nodeResults: [{
        nodeId: "task-b",
        status: "completed",
        compensation: {
          status: "completed",
          startedAt: new Date("2026-10-22T10:00:00.000Z"),
          completedAt: new Date("2026-10-22T10:00:01.000Z"),
          error: null,
        },
      }],
    },
    {
      ...execution,
      _id: new Types.ObjectId(),
      status: "compensation_failed",
      error: { code: "EXECUTION_FAILED", message: "Task failed" },
      nodeResults: [{
        nodeId: "task-c",
        status: "completed",
        compensation: {
          status: "failed",
          startedAt: new Date("2026-10-22T10:00:00.000Z"),
          completedAt: new Date("2026-10-22T10:00:01.000Z"),
          error: { code: "COMPENSATION_FAILED", message: "Rollback failed" },
        },
      }],
    },
    {
      ...execution,
      _id: new Types.ObjectId(),
      status: "completed",
      error: null,
      nodeResults: [{ nodeId: "legacy-task", status: "completed" }],
    },
  ];

  const response = await fetch(
    `${baseUrl}/api/workflows/${workflowId}/executions`,
    { headers: authHeaders() },
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.message, "Execution history retrieved successfully");
  assert.deepEqual(
    body.executions.map((item: any) => item.status),
    ["compensating", "compensated", "compensation_failed", "completed"],
  );
  assert.equal(body.executions[0].nodeResults[0].compensation.status, "running");
  assert.equal(body.executions[1].nodeResults[0].compensation.status, "completed");
  assert.deepEqual(body.executions[2].error, {
    code: "EXECUTION_FAILED",
    message: "Task failed",
  });
  assert.deepEqual(body.executions[2].nodeResults[0].compensation.error, {
    code: "COMPENSATION_FAILED",
    message: "Rollback failed",
  });
  assert.equal(
    Object.hasOwn(body.executions[3].nodeResults[0], "compensation"),
    false,
  );
  assert.deepEqual(body.pagination, {
    limit: 20,
    hasMore: false,
    nextCursor: null,
  });
});

test("does not return another tenant's execution details or compensation metadata", async () => {
  resetState();
  execution.status = "compensation_failed";
  execution.error = {
    code: "PRIVATE_TASK_ERROR",
    message: "Private task error",
  };
  execution.nodeResults = [{
    nodeId: "private-task",
    status: "completed",
    compensation: {
      status: "failed",
      startedAt: new Date(),
      completedAt: new Date(),
      error: {
        code: "PRIVATE_UNDO_ERROR",
        message: "Private compensation error",
      },
    },
  }];

  const response = await fetch(
    `${baseUrl}/api/executions/${executionId}`,
    { headers: { "x-api-key": "other-test-key" } },
  );

  assert.equal(response.status, 404);
  assert.equal(receivedTenantId, String(otherTenantId));
  assert.deepEqual(await response.json(), {
    error: {
      code: "EXECUTION_NOT_FOUND",
      message: "Execution not found",
    },
  });
});

test("does not return another tenant's execution history or compensation metadata", async () => {
  resetState();
  historyRecords = [{
    ...execution,
    status: "compensation_failed",
    error: { code: "PRIVATE_TASK_ERROR", message: "Private task error" },
    nodeResults: [{
      nodeId: "private-task",
      status: "completed",
      compensation: {
        status: "failed",
        startedAt: new Date(),
        completedAt: new Date(),
        error: {
          code: "PRIVATE_UNDO_ERROR",
          message: "Private compensation error",
        },
      },
    }],
  }];

  const response = await fetch(
    `${baseUrl}/api/workflows/${workflowId}/executions`,
    { headers: { "x-api-key": "other-test-key" } },
  );

  assert.equal(response.status, 200);
  assert.equal(receivedTenantId, String(otherTenantId));
  const body = await response.json();
  assert.deepEqual(body.executions, []);
  assert.deepEqual(body.pagination, {
    limit: 20,
    hasMore: false,
    nextCursor: null,
  });
});

test("rejects GET /api/executions/summary without an API key", async () => {
  resetState();
  const response = await fetch(`${baseUrl}/api/executions/summary`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: {
      code: "UNAUTHORIZED",
      message: "A valid API key is required",
    },
  });
});

test("returns execution summary with default filters for authenticated tenant", async () => {
  resetState();
  const response = await fetch(`${baseUrl}/api/executions/summary`, {
    headers: authHeaders(),
  });

  assert.equal(response.status, 200);
  assert.equal(receivedTenantId, String(tenantId));
  assert.deepEqual(receivedSummaryOptions, {
    workflowId: undefined,
    from: undefined,
    to: undefined,
  });

  const body = await response.json();
  assert.equal(body.summary.total, 10);
  assert.equal(body.summary.completed, 8);
  assert.equal(body.summary.unsuccessful, 1);
  assert.equal(body.filter.workflowId, null);
  assert.equal(body.filter.from, null);
  assert.equal(body.filter.to, null);
});

test("passes workflowId, from, and to query parameters to service", async () => {
  resetState();
  const validWorkflowId = new Types.ObjectId().toString();
  const from = "2026-10-01T00:00:00.000Z";
  const to = "2026-10-15T23:59:59.999Z";

  const response = await fetch(
    `${baseUrl}/api/executions/summary?workflowId=${validWorkflowId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { headers: authHeaders() },
  );

  assert.equal(response.status, 200);
  assert.equal(receivedTenantId, String(tenantId));
  assert.deepEqual(receivedSummaryOptions, {
    workflowId: validWorkflowId,
    from,
    to,
  });

  const body = await response.json();
  assert.equal(body.filter.workflowId, validWorkflowId);
  assert.equal(body.filter.from, from);
  assert.equal(body.filter.to, to);
});

test("returns 400 when workflowId query parameter is invalid", async () => {
  resetState();
  const response = await fetch(
    `${baseUrl}/api/executions/summary?workflowId=invalid-id`,
    { headers: authHeaders() },
  );

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(body.error.message, "Invalid workflow ID");
});

test("returns 400 when from date string is invalid", async () => {
  resetState();
  const response = await fetch(
    `${baseUrl}/api/executions/summary?from=not-a-date`,
    { headers: authHeaders() },
  );

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(body.error.message, "Invalid 'from' date string");
});

test("returns 400 when to date string is invalid", async () => {
  resetState();
  const response = await fetch(
    `${baseUrl}/api/executions/summary?to=not-a-date`,
    { headers: authHeaders() },
  );

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(body.error.message, "Invalid 'to' date string");
});

test("returns 400 when from date is after to date", async () => {
  resetState();
  const from = "2026-10-20T00:00:00.000Z";
  const to = "2026-10-10T00:00:00.000Z";

  const response = await fetch(
    `${baseUrl}/api/executions/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { headers: authHeaders() },
  );

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(body.error.message, "'from' date cannot be after 'to' date");
});

test("does not collide with /api/executions/:executionId route", async () => {
  resetState();
  // Call /api/executions/summary
  const summaryRes = await fetch(`${baseUrl}/api/executions/summary`, {
    headers: authHeaders(),
  });
  assert.equal(summaryRes.status, 200);
  assert.equal(receivedExecutionId, undefined);

  // Call /api/executions/:executionId
  resetState();
  const detailRes = await fetch(`${baseUrl}/api/executions/${executionId}`, {
    headers: authHeaders(),
  });
  assert.equal(detailRes.status, 200);
  assert.equal(receivedExecutionId, String(executionId));
});

test("returns 404 when GET /api/workflows/summary is attempted", async () => {
  resetState();
  const response = await fetch(`${baseUrl}/api/workflows/summary`, {
    headers: authHeaders(),
  });
  assert.equal(response.status, 404);
});

test("strictly scopes summary request to authenticated tenant", async () => {
  resetState();
  const response = await fetch(`${baseUrl}/api/executions/summary`, {
    headers: { "x-api-key": "other-test-key" },
  });

  assert.equal(response.status, 200);
  assert.equal(receivedTenantId, String(otherTenantId));
});
