import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { Types } from "mongoose";

import { errorHandler } from "../middleware/errorHandler.middleware";
import type { TenantResolver } from "../services/tenantResolver";
import { createWorkflowRouter } from "./workflow.routes";
import { validGraph } from "../validators/validGraph.fixture";
import type { WorkflowGraph } from "../validators/workflow-graph.validator";

const tenantId = new Types.ObjectId();
const otherTenantId = new Types.ObjectId();

let server: Server;
let baseUrl: string;

const createWorkflowCalls: unknown[] = [];
const listedTenantIds: Types.ObjectId[] = [];
const graphUpdateCalls: Array<{
  tenantId: Types.ObjectId;
  workflowId: string;
  graph: typeof validGraph;
}> = [];
const deleteWorkflowCalls: Array<{
  tenantId: Types.ObjectId;
  workflowId: string;
}> = [];

const resolver: TenantResolver = {
  async resolverTenant(apiKey: string) {
    if (apiKey !== "valid-test-key" && apiKey !== "other-test-key") return null;

    // Keep the test independent of the real database.
    return {
      tenantId: apiKey === "valid-test-key" ? tenantId : otherTenantId,
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
    input: { name: string; description?: string; graph: WorkflowGraph };
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

  async updateWorkflow({ tenantId: requestedTenantId, workflowId, input }: {
    tenantId: Types.ObjectId;
    workflowId: Types.ObjectId;
    input: { name?: string; description?: string; graph?: typeof validGraph };
  }) {
    return {
      ...createdWorkflow,
      _id: workflowId.toString(),
      tenantId: requestedTenantId,
      ...input,
    };
  },

  async updateWorkflowGraph(
    requestedTenantId: Types.ObjectId,
    workflowId: string,
    graph: WorkflowGraph,
  ) {
    graphUpdateCalls.push({
      tenantId: requestedTenantId,
      workflowId,
      graph,
    });
    return {
      ...createdWorkflow,
      _id: workflowId,
      tenantId: requestedTenantId,
      graph,
    };
  },

  async deleteWorkflow(
    requestedTenantId: Types.ObjectId,
    workflowId: string,
  ) {
    deleteWorkflowCalls.push({
      tenantId: requestedTenantId,
      workflowId,
    });
    if (
      !requestedTenantId.equals(tenantId) ||
      workflowId !== "6ad9a2f75b4a085ee3c2c269"
    ) {
      return null;
    }

    return { ...createdWorkflow, tenantId: requestedTenantId };
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

test("deletes a workflow using the authenticated tenant context", async () => {
  const callsBefore = deleteWorkflowCalls.length;
  const response = await fetch(
    `${baseUrl}/6ad9a2f75b4a085ee3c2c269`,
    { method: "DELETE", headers: { "x-api-key": "valid-test-key" } },
  );

  assert.equal(response.status, 200);
  assert.equal(deleteWorkflowCalls.length, callsBefore + 1);
  assert.equal(deleteWorkflowCalls.at(-1)?.tenantId.toString(), tenantId.toString());
  assert.equal(deleteWorkflowCalls.at(-1)?.workflowId, "6ad9a2f75b4a085ee3c2c269");
});

test("requires tenant authentication before deleting a workflow", async () => {
  const response = await fetch(
    `${baseUrl}/6ad9a2f75b4a085ee3c2c269`,
    { method: "DELETE" },
  );
  assert.equal(response.status, 401);
});

test("rejects invalid IDs and returns not found for missing or other-tenant workflows", async () => {
  const callsBefore = deleteWorkflowCalls.length;
  const invalidId = await fetch(`${baseUrl}/invalid-id`, {
    method: "DELETE",
    headers: { "x-api-key": "valid-test-key" },
  });
  const missing = await fetch(`${baseUrl}/6ad9a2f75b4a085ee3c2c260`, {
    method: "DELETE",
    headers: { "x-api-key": "valid-test-key" },
  });
  const otherTenant = await fetch(
    `${baseUrl}/6ad9a2f75b4a085ee3c2c269`,
    { method: "DELETE", headers: { "x-api-key": "other-test-key" } },
  );

  assert.equal(invalidId.status, 400);
  assert.equal(missing.status, 404);
  assert.equal(otherTenant.status, 404);
  assert.equal(deleteWorkflowCalls.length, callsBefore + 2);
  assert.equal(deleteWorkflowCalls.at(-1)?.tenantId.toString(), otherTenantId.toString());
  assert.deepEqual((await otherTenant.json()).error, {
    code: "WORKFLOW_NOT_FOUND",
    message: "Workflow not found",
  });
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

test("updates the graph using the authenticated tenant context", async () => {
  const response = await fetch(
    `${baseUrl}/6ad9a2f75b4a085ee3c2c269/graph`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "valid-test-key",
      },
      body: JSON.stringify({ graph: validGraph }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(graphUpdateCalls.at(-1)?.tenantId.toString(), tenantId.toString());
  assert.equal(graphUpdateCalls.at(-1)?.workflowId, "6ad9a2f75b4a085ee3c2c269");
  assert.deepEqual(graphUpdateCalls.at(-1)?.graph, validGraph);
});

test("rejects graph updates with invalid IDs or invalid graphs", async () => {
  const callsBefore = graphUpdateCalls.length;
  const invalidIdResponse = await fetch(`${baseUrl}/invalid/graph`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "valid-test-key",
    },
    body: JSON.stringify({ graph: validGraph }),
  });
  const invalidGraphResponse = await fetch(
    `${baseUrl}/6ad9a2f75b4a085ee3c2c269/graph`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "valid-test-key",
      },
      body: JSON.stringify({ graph: { version: 2, nodes: [], edges: [] } }),
    },
  );
  const conditionNode = validGraph.nodes.find(
    (node) => node.type === "condition",
  );
  assert.ok(conditionNode);
  const missingConditionConfig: WorkflowGraph = structuredClone(validGraph);
  delete missingConditionConfig.nodes.find(
    (node) => node.type === "condition",
  )!.data.config;
  const missingConfigResponse = await fetch(
    `${baseUrl}/6ad9a2f75b4a085ee3c2c269/graph`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "valid-test-key",
      },
      body: JSON.stringify({ graph: missingConditionConfig }),
    },
  );
  const unsupportedConditionConfig: WorkflowGraph = structuredClone(validGraph);
  unsupportedConditionConfig.nodes.find(
    (node) => node.type === "condition",
  )!.data.config = {
    type: "group",
    logic: "and",
    clauses: [{ left: "approved", op: "equals", right: true }],
  };
  const unsupportedConfigResponse = await fetch(
    `${baseUrl}/6ad9a2f75b4a085ee3c2c269/graph`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "valid-test-key",
      },
      body: JSON.stringify({ graph: unsupportedConditionConfig }),
    },
  );
  const malformedShapeResponse = await fetch(
    `${baseUrl}/6ad9a2f75b4a085ee3c2c269/graph`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "valid-test-key",
      },
      body: JSON.stringify({ graph: validGraph, tenantId: new Types.ObjectId() }),
    },
  );

  assert.equal(invalidIdResponse.status, 400);
  assert.equal(invalidGraphResponse.status, 400);
  assert.equal(missingConfigResponse.status, 400);
  assert.equal(unsupportedConfigResponse.status, 400);
  assert.equal(malformedShapeResponse.status, 400);
  assert.equal(graphUpdateCalls.length, callsBefore);
});

test("rejects syntactically malformed JSON without exposing parser details", async () => {
  const callsBefore = graphUpdateCalls.length;
  const response = await fetch(
    `${baseUrl}/6ad9a2f75b4a085ee3c2c269/graph`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "valid-test-key",
      },
      body: '{"graph":',
    },
  );
  const body = (await response.json()) as {
    error?: { code?: string; message?: string };
  };

  assert.equal(response.status, 400);
  assert.equal(body.error?.code, "INVALID_JSON");
  assert.equal(body.error?.message, "Request body must be valid JSON.");
  assert.equal(graphUpdateCalls.length, callsBefore);
});
