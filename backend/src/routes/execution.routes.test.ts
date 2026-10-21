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
const executionId = new Types.ObjectId();
const workflowId = new Types.ObjectId();

let server: Server;
let baseUrl: string;
let receivedTenantId: string | undefined;
let receivedWorkflowId: string | undefined;
let receivedExecutionId: string | undefined;
let receivedLimit: unknown;
let receivedCursor: unknown;

let mode: "normal" | "execution-error" | "not-found" = "normal";



const resolver: TenantResolver = {
  async resolverTenant(apiKey: string) {
    if (apiKey !== "valid-test-key") return null;

    return {
      tenantId,
    } as NonNullable<
      Awaited<ReturnType<TenantResolver["resolverTenant"]>>
    >;
  },
};

const execution = {
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
  async startExecution(tenant: Types.ObjectId, id: string) {
    receivedTenantId = String(tenant);
    receivedWorkflowId = id;
    if (!/^[a-f\d]{24}$/i.test(id)) {
      throw new ExecutionServiceError(400, "VALIDATION_ERROR", "Invalid workflow ID");
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
      throw new ExecutionServiceError(400, "VALIDATION_ERROR", "Invalid execution ID");
    }

    if (mode === "unexpected-error") {
      throw new Error("private-db-secret internal stack details");
    }


    if (mode === "not-found") {
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
      executions: [],
      pagination: {
        limit: limit === undefined ? 20 : Number(limit),
        hasMore: false,
        nextCursor: null,
      },
    };
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


test("executes a workflow using the authenticated tenant", async () => {
  resetState();

  const response = await fetch(
    `${baseUrl}/api/workflows/${workflowId}/executions`,
    { method: "POST", headers: authHeaders() },
  );

  assert.equal(response.status, 200);
  assert.equal(receivedTenantId, String(tenantId));
  assert.equal(receivedWorkflowId, String(workflowId));

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
  mode = "unexpected-error";
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