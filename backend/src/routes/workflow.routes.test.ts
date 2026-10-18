import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { Types } from "mongoose";

import { errorHandler } from "../middleware/errorHandler.middleware";
import type { TenantResolver } from "../services/tenantResolver";
import { createWorkflowRouter } from "./workflow.routes";
import { validGraph } from "../validators/validGraph.fixture";

const tenantId = new Types.ObjectId();

let server: Server;
let baseUrl: string;

const createWorkflowCalls: unknown[] = [];
const listedTenantIds: Types.ObjectId[] = [];

const resolver: TenantResolver = {
  async resolverTenant(apiKey: string) {
    if (apiKey !== "valid-test-key") {
      return null;
    }

    // Keep the test independent of the real database.
    return {
      tenantId,
    } as NonNullable<
      Awaited<ReturnType<TenantResolver["resolverTenant"]>>
    >;
  },
};

const createdWorkflow = {
  _id: "workflow-test-id",
  tenantId,
  name: "Demo workflow",
  description: "Route test",
  graph: validGraph,
  status: "draft" as const,
  version: 1 as const,
};

const service = {
  async createWorkflow(command: {
    tenantId: Types.ObjectId;
    input: { name: string; description?: string; graph: typeof validGraph };
  }) {
    createWorkflowCalls.push(command);

    return {
      ...createdWorkflow,
      tenantId: command.tenantId,
      name: command.input.name,
      description: command.input.description,
      graph: command.input.graph,
    };
  },

  async listWorkflows(requestedTenantId: Types.ObjectId) {
    listedTenantIds.push(requestedTenantId);
    return [];
  },
};

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/workflows", createWorkflowRouter(resolver, service));
  app.use(errorHandler);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
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
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Demo workflow" }),
  });

  assert.equal(response.status, 401);
});

test("rejects an unresolved API key", async () => {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "invalid-test-key",
    },
    body: JSON.stringify({ name: "Demo workflow" }),
  });

  assert.equal(response.status, 401);
});

test("creates a workflow using the trusted tenant context", async () => {
  const callsBefore = createWorkflowCalls.length;

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "valid-test-key",
    },
    body: JSON.stringify({
      name: "Demo workflow",
      description: "Route test",
      graph: validGraph,
    }),
  });

  assert.equal(response.status, 201);

  const body = (await response.json()) as {
    workflow: {
      tenantId: string;
      name: string;
      status: string;
      version: number;
      graph: typeof validGraph;
    };
  };

  assert.equal(body.workflow.tenantId, tenantId.toString());
  assert.equal(body.workflow.name, "Demo workflow");
  assert.equal(body.workflow.status, "draft");
  assert.equal(body.workflow.version, 1);
  assert.deepEqual(body.workflow.graph, validGraph);

  assert.equal(createWorkflowCalls.length, callsBefore + 1);

  const lastCall = createWorkflowCalls[createWorkflowCalls.length - 1] as {
    tenantId: Types.ObjectId;
  };

  assert.equal(lastCall.tenantId.toString(), tenantId.toString());
});

test("rejects client-supplied tenantId, status, and version", async () => {
  const cases = [
    {
      name: "Demo workflow",
      graph: validGraph,
      tenantId: new Types.ObjectId().toString(),
    },
    { name: "Demo workflow", graph: validGraph, status: "active" },
    { name: "Demo workflow", graph: validGraph, version: 99 },
  ];

  const callsBefore = createWorkflowCalls.length;

  for (const payload of cases) {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "valid-test-key",
      },
      body: JSON.stringify(payload),
    });

    assert.equal(response.status, 400);
  }

  assert.equal(
    createWorkflowCalls.length,
    callsBefore,
    "Invalid requests must not reach the workflow service",
  );
});

test("lists workflows using the trusted tenant even when a tenantId query is supplied", async () => {
  const attackerTenantId = new Types.ObjectId();
  const callsBefore = listedTenantIds.length;

  const response = await fetch(
    `${baseUrl}?tenantId=${attackerTenantId.toString()}`,
    {
      headers: { "x-api-key": "valid-test-key" },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(listedTenantIds.length, callsBefore + 1);

  const lastListedTenantId = listedTenantIds[listedTenantIds.length - 1];

  assert.equal(lastListedTenantId.toString(), tenantId.toString());
  assert.notEqual(
    lastListedTenantId.toString(),
    attackerTenantId.toString(),
  );
});

test("rejects a blank workflow name", async () => {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "valid-test-key",
    },
    body: JSON.stringify({ name: "   ", graph: validGraph }),
  });

  assert.equal(response.status, 400);
});
