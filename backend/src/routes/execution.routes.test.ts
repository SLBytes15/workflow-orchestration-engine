import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { Types } from "mongoose";

import {
  createExecutionService,
  ExecutionServiceError,
} from "../services/execution.service";
import type { TenantResolver } from "../services/tenantResolver";
import { errorHandler } from "../middleware/errorHandler.middleware";
import { createExecutionRouter } from "./execution.routes";

const tenantId = new Types.ObjectId();
const workflowId = new Types.ObjectId();
const executionId = new Types.ObjectId();

let server: Server;
let baseUrl: string;
let shouldThrowUnexpectedError = false;
let shouldQueueExecution = true;
let receivedTenantId: Types.ObjectId | undefined;

const resolver: TenantResolver = {
  async resolverTenant(apiKey: string) {
    if (apiKey !== "valid-test-key") return null;

    return {
      tenantId,
    } as NonNullable<Awaited<ReturnType<TenantResolver["resolverTenant"]>>>;
  },
};

const execution = {
  _id: executionId,
  tenantId,
  workflowId,
  workflowVersion: 1,
  status: "queued",
  startedAt: null,
  createdAt: new Date("2026-10-18T08:00:00.000Z"),
};

const service = {
  async startExecution(tenant: Types.ObjectId) {
    receivedTenantId = tenant;

    if (shouldThrowUnexpectedError) {
      throw new Error("private internal detail");
    }

    if (!shouldQueueExecution) {
      throw new ExecutionServiceError(
        503,
        "EXECUTION_QUEUE_UNAVAILABLE",
        "Workflow execution is temporarily unavailable",
      );
    }

    return execution;
  },

  async getExecution(tenant: Types.ObjectId, id: string) {
    receivedTenantId = tenant;

    if (id !== String(executionId)) {
      throw new ExecutionServiceError(
        404,
        "EXECUTION_NOT_FOUND",
        "Execution not found",
      );
    }

    return execution;
  },

  async listExecutions(tenant: Types.ObjectId) {
    receivedTenantId = tenant;

    return {
      executions: [],
      pagination: {
        limit: 20,
        hasMore: false,
        nextCursor: null,
      },
    };
  },
};

before(async () => {
  const app = express();
  app.use(express.json());

  // Test-only mount path. The production mount is verified separately.
  app.use("/api/workflows", createExecutionRouter(resolver, service as never));

  app.use(errorHandler);

  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine test server address");
  }

  baseUrl = `http://127.0.0.1:${address.port}/api/workflows`;
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

test("rejects a request without an API key", async () => {
  const response = await fetch(`${baseUrl}/${workflowId}/executions`, {
    method: "POST",
  });

  assert.equal(response.status, 401);
});

test("rejects an unresolved API key", async () => {
  const response = await fetch(`${baseUrl}/${workflowId}/executions`, {
    method: "POST",
    headers: { "x-api-key": "invalid-test-key" },
  });

  assert.equal(response.status, 401);
});

test("creates an execution using the trusted tenant context", async () => {
  shouldThrowUnexpectedError = false;
  shouldQueueExecution = true;
  receivedTenantId = undefined;

  const response = await fetch(`${baseUrl}/${workflowId}/executions`, {
    method: "POST",
    headers: {
      "x-api-key": "valid-test-key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tenantId: new Types.ObjectId().toString(),
    }),
  });

  assert.equal(response.status, 202);
  assert.equal(String(receivedTenantId), String(tenantId));

  const body = (await response.json()) as {
    execution: {
      id: string;
      workflowId: string;
      status: string;
    };
  };

  assert.equal(body.execution.id, String(executionId));
  assert.equal(body.execution.workflowId, String(workflowId));
  assert.equal(body.execution.status, "queued");
});

test("returns 503 when the execution queue is unavailable", async () => {
  shouldQueueExecution = false;

  const response = await fetch(`${baseUrl}/${workflowId}/executions`, {
    method: "POST",
    headers: { "x-api-key": "valid-test-key" },
  });

  assert.equal(response.status, 503);

  const body = (await response.json()) as {
    error: { code: string };
  };

  assert.equal(body.error.code, "EXECUTION_QUEUE_UNAVAILABLE");
  shouldQueueExecution = true;
});

test("returns 404 for an execution unavailable to the tenant", async () => {
  const response = await fetch(`${baseUrl}/${new Types.ObjectId()}`, {
    headers: { "x-api-key": "valid-test-key" },
  });

  assert.equal(response.status, 404);
});

test("returns a sanitized response for unexpected errors", async () => {
  shouldThrowUnexpectedError = true;

  const response = await fetch(`${baseUrl}/${workflowId}/executions`, {
    method: "POST",
    headers: { "x-api-key": "valid-test-key" },
  });

  assert.equal(response.status, 500);

  const body = (await response.json()) as {
    error: { code: string; message: string };
  };

  assert.equal(body.error.code, "INTERNAL_SERVER_ERROR");
  assert.equal(body.error.message, "An unexpected error occurred.");
  assert.equal(JSON.stringify(body).includes("private internal detail"), false);

  shouldThrowUnexpectedError = false;
});
