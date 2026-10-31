import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { Types } from "mongoose";

import { errorHandler } from "../middleware/errorHandler.middleware";
import { tenantAuthMiddleware } from "../middleware/tenantAuth.middleware";
import {
  createTenantResolver,
  type TenantResolverDependencies,
} from "../services/tenantResolver";
import { generateApiKey } from "../services/apiKeyCrypto";
import { createWorkflowRouter } from "./workflow.routes";
import { createWorkflowService } from "../services/workflow.service";
import { createExecutionRouter } from "./execution.routes";
import { ExecutionServiceError } from "../services/execution.service";
import { validGraph } from "../validators/validGraph.fixture";

interface StoredApiKey {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  status: "active" | "revoked";
  expiresAt: Date | null;
  revokedAt: Date | null;
}

interface StoredTenant {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  status: "active" | "inactive";
}

interface StoredWorkflow {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  description?: string;
  graph: typeof validGraph;
  status: "draft" | "active" | "paused";
  version: number;
}

interface StoredExecution {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  workflowId: Types.ObjectId;
  workflowVersion: number;
  status: "completed" | "failed";
  currentNodeId: string | null;
  nodeResults: Array<{ nodeId: string; status: string }>;
  error: string | null;
  startedAt: Date;
  completedAt: Date;
  createdAt: Date;
}

// In-memory test fixture state
const tenantAId = new Types.ObjectId();
const tenantBId = new Types.ObjectId();

const workflowAId = new Types.ObjectId();
const workflowBId = new Types.ObjectId();

const executionAId = new Types.ObjectId();
const executionBId = new Types.ObjectId();

const keyA1 = generateApiKey();
const keyA2 = generateApiKey();
const keyB = generateApiKey();
const revokedKey = generateApiKey();
const expiredKey = generateApiKey();
const unregisteredKey = generateApiKey();

const tenantsMap = new Map<string, StoredTenant>([
  [
    tenantAId.toString(),
    {
      _id: tenantAId,
      name: "Tenant Alpha",
      slug: "tenant-alpha",
      status: "active",
    },
  ],
  [
    tenantBId.toString(),
    {
      _id: tenantBId,
      name: "Tenant Beta",
      slug: "tenant-beta",
      status: "active",
    },
  ],
]);

const apiKeysMap = new Map<string, StoredApiKey>([
  [
    keyA1.keyHash,
    {
      _id: new Types.ObjectId(),
      tenantId: tenantAId,
      status: "active",
      expiresAt: null,
      revokedAt: null,
    },
  ],
  [
    keyA2.keyHash,
    {
      _id: new Types.ObjectId(),
      tenantId: tenantAId,
      status: "active",
      expiresAt: null,
      revokedAt: null,
    },
  ],
  [
    keyB.keyHash,
    {
      _id: new Types.ObjectId(),
      tenantId: tenantBId,
      status: "active",
      expiresAt: null,
      revokedAt: null,
    },
  ],
  [
    revokedKey.keyHash,
    {
      _id: new Types.ObjectId(),
      tenantId: tenantAId,
      status: "revoked",
      expiresAt: null,
      revokedAt: new Date(Date.now() - 60000),
    },
  ],
  [
    expiredKey.keyHash,
    {
      _id: new Types.ObjectId(),
      tenantId: tenantAId,
      status: "active",
      expiresAt: new Date(Date.now() - 3600000),
      revokedAt: null,
    },
  ],
]);

const workflowsMap = new Map<string, StoredWorkflow>([
  [
    workflowAId.toString(),
    {
      _id: workflowAId,
      tenantId: tenantAId,
      name: "Alpha Workflow",
      description: "Tenant Alpha private workflow",
      graph: validGraph,
      status: "draft",
      version: 1,
    },
  ],
  [
    workflowBId.toString(),
    {
      _id: workflowBId,
      tenantId: tenantBId,
      name: "Beta Workflow",
      description: "Tenant Beta private workflow",
      graph: validGraph,
      status: "draft",
      version: 1,
    },
  ],
]);

const executionsMap = new Map<string, StoredExecution>([
  [
    executionAId.toString(),
    {
      _id: executionAId,
      tenantId: tenantAId,
      workflowId: workflowAId,
      workflowVersion: 1,
      status: "completed",
      currentNodeId: null,
      nodeResults: [{ nodeId: "trigger-1", status: "completed" }],
      error: null,
      startedAt: new Date("2026-10-20T10:00:00.000Z"),
      completedAt: new Date("2026-10-20T10:00:01.000Z"),
      createdAt: new Date("2026-10-20T10:00:00.000Z"),
    },
  ],
  [
    executionBId.toString(),
    {
      _id: executionBId,
      tenantId: tenantBId,
      workflowId: workflowBId,
      workflowVersion: 1,
      status: "completed",
      currentNodeId: null,
      nodeResults: [{ nodeId: "trigger-1", status: "completed" }],
      error: null,
      startedAt: new Date("2026-10-20T11:00:00.000Z"),
      completedAt: new Date("2026-10-20T11:00:01.000Z"),
      createdAt: new Date("2026-10-20T11:00:00.000Z"),
    },
  ],
]);

// Resolver using actual SHA-256 hash lookup and status checks
const resolverDependencies: TenantResolverDependencies = {
  async findApiKeyByHash(hash: string) {
    return apiKeysMap.get(hash) ?? null;
  },
  async findTenantById(id: Types.ObjectId) {
    return tenantsMap.get(id.toString()) ?? null;
  },
};
const tenantResolver = createTenantResolver(resolverDependencies);

// Workflow service with strict tenant isolation
const workflowService = createWorkflowService({
  async createWorkflowRecord(record) {
    const _id = new Types.ObjectId();
    const stored: StoredWorkflow = {
      _id,
      tenantId: record.tenantId,
      name: record.name,
      description: record.description,
      graph: record.graph,
      status: record.status ?? "draft",
      version: record.version ?? 1,
    };
    workflowsMap.set(_id.toString(), stored);
    return stored;
  },

  async findWorkflowRecordsByTenant(tenantId: Types.ObjectId) {
    return Array.from(workflowsMap.values()).filter((w) =>
      w.tenantId.equals(tenantId),
    );
  },

  async findWorkflowRecordById(tenantId: Types.ObjectId, workflowId: Types.ObjectId) {
    const workflow = workflowsMap.get(workflowId.toString());
    if (!workflow || !workflow.tenantId.equals(tenantId)) {
      return null;
    }
    return workflow;
  },

  async updateWorkflowRecord(tenantId: Types.ObjectId, workflowId: Types.ObjectId, updates: Record<string, unknown>) {
    const workflow = workflowsMap.get(workflowId.toString());
    if (!workflow || !workflow.tenantId.equals(tenantId)) {
      return null;
    }
    const updated = {
      ...workflow,
      ...updates,
      version: workflow.version + 1,
    };
    workflowsMap.set(workflowId.toString(), updated as StoredWorkflow);
    return updated;
  },

  async deleteWorkflow(tenantId: Types.ObjectId, workflowId: Types.ObjectId) {
    const workflow = workflowsMap.get(workflowId.toString());
    if (!workflow || !workflow.tenantId.equals(tenantId)) {
      return null;
    }
    workflowsMap.delete(workflowId.toString());
    return workflow;
  },
});

// Execution service mock with strict tenant isolation
const executionService = {
  async startExecution(
    tenant: Types.ObjectId,
    workflowIdStr: string,
    _input: Record<string, unknown> = {},
  ) {
    const workflow = workflowsMap.get(workflowIdStr);
    if (!workflow || !workflow.tenantId.equals(tenant)) {
      throw new ExecutionServiceError(404, "WORKFLOW_NOT_FOUND", "Workflow not found");
    }
    const execId = new Types.ObjectId();
    const newExec: StoredExecution = {
      _id: execId,
      tenantId: tenant,
      workflowId: workflow._id,
      workflowVersion: workflow.version,
      status: "completed",
      currentNodeId: null,
      nodeResults: [],
      error: null,
      startedAt: new Date(),
      completedAt: new Date(),
      createdAt: new Date(),
    };
    executionsMap.set(execId.toString(), newExec);
    return newExec;
  },

  async listExecutions(
    tenant: Types.ObjectId,
    workflowIdStr: string,
    _limit?: unknown,
    _cursor?: unknown,
  ) {
    const workflow = workflowsMap.get(workflowIdStr);
    if (!workflow || !workflow.tenantId.equals(tenant)) {
      throw new ExecutionServiceError(404, "WORKFLOW_NOT_FOUND", "Workflow not found");
    }
    const executions = Array.from(executionsMap.values()).filter(
      (e) => e.tenantId.equals(tenant) && e.workflowId.toString() === workflowIdStr,
    );
    return {
      executions,
      nextCursor: null,
      hasMore: false,
    };
  },

  async getExecution(tenant: Types.ObjectId, executionIdStr: string) {
    const exec = executionsMap.get(executionIdStr);
    if (!exec || !exec.tenantId.equals(tenant)) {
      throw new ExecutionServiceError(404, "EXECUTION_NOT_FOUND", "Execution not found");
    }
    return exec;
  },
};

let server: Server;
let baseUrl: string;

before(async () => {
  const app = express();
  app.use(express.json());

  const requireTenantAuth = tenantAuthMiddleware(tenantResolver);

  // Authenticated tenant test endpoint matching app.ts
  app.get("/api/test-authenticated-tenant", requireTenantAuth, (req, res) => {
    const tenantContext = req.tenantContext;
    if (!tenantContext) {
      res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "A valid API key is required" },
      });
      return;
    }
    res.status(200).json({
      message: "Tenant authenticated successfully",
      tenantId: tenantContext.tenantId.toString(),
    });
  });

  app.use("/api/workflows", createWorkflowRouter(tenantResolver, workflowService));
  app.use("/api/workflows", createExecutionRouter(tenantResolver, executionService as never));
  app.use("/api/executions", createExecutionRouter(tenantResolver, executionService as never));
  app.use(errorHandler);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Unable to determine server port");
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

test("1. Key A resolves to Tenant A", async () => {
  const res = await fetch(`${baseUrl}/api/test-authenticated-tenant`, {
    headers: { "x-api-key": keyA1.plaintextKey },
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as { message: string; tenantId: string };
  assert.equal(data.message, "Tenant authenticated successfully");
  assert.equal(data.tenantId, tenantAId.toString());
});

test("2. Key B resolves to Tenant B", async () => {
  const res = await fetch(`${baseUrl}/api/test-authenticated-tenant`, {
    headers: { "x-api-key": keyB.plaintextKey },
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as { message: string; tenantId: string };
  assert.equal(data.message, "Tenant authenticated successfully");
  assert.equal(data.tenantId, tenantBId.toString());
  assert.notEqual(data.tenantId, tenantAId.toString());
});

test("3. Tenant A's workflow list excludes Tenant B's workflows", async () => {
  const res = await fetch(`${baseUrl}/api/workflows`, {
    headers: { "x-api-key": keyA1.plaintextKey },
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as { workflows: Array<{ _id: string; name: string }> };
  assert.equal(Array.isArray(data.workflows), true);
  assert.equal(data.workflows.length, 1);
  assert.equal(data.workflows[0]._id, workflowAId.toString());
  assert.equal(data.workflows[0].name, "Alpha Workflow");
  assert.equal(
    data.workflows.some((w) => w._id === workflowBId.toString()),
    false,
  );
  assert.equal(
    data.workflows.some((w) => w.name === "Beta Workflow"),
    false,
  );
});

test("4. Tenant B's workflow list excludes Tenant A's workflows", async () => {
  const res = await fetch(`${baseUrl}/api/workflows`, {
    headers: { "x-api-key": keyB.plaintextKey },
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as { workflows: Array<{ _id: string; name: string }> };
  assert.equal(Array.isArray(data.workflows), true);
  assert.equal(data.workflows.length, 1);
  assert.equal(data.workflows[0]._id, workflowBId.toString());
  assert.equal(data.workflows[0].name, "Beta Workflow");
  assert.equal(
    data.workflows.some((w) => w._id === workflowAId.toString()),
    false,
  );
  assert.equal(
    data.workflows.some((w) => w.name === "Alpha Workflow"),
    false,
  );
});

test("5. Tenant B cannot retrieve, update, or delete Tenant A's workflow by supplying its ID", async () => {
  // Retrieve Tenant A's workflow with Tenant B's key -> 404
  const getRes = await fetch(`${baseUrl}/api/workflows/${workflowAId.toString()}`, {
    headers: { "x-api-key": keyB.plaintextKey },
  });
  assert.equal(getRes.status, 404);
  const getData = (await getRes.json()) as { error: { code: string } };
  assert.equal(getData.error.code, "WORKFLOW_NOT_FOUND");

  // Update Tenant A's workflow with Tenant B's key -> 404
  const patchRes = await fetch(`${baseUrl}/api/workflows/${workflowAId.toString()}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": keyB.plaintextKey,
    },
    body: JSON.stringify({ name: "Tampered by Tenant B" }),
  });
  assert.equal(patchRes.status, 404);
  const patchData = (await patchRes.json()) as { error: { code: string } };
  assert.equal(patchData.error.code, "WORKFLOW_NOT_FOUND");
  // Verify workflow in store was untouched
  assert.equal(workflowsMap.get(workflowAId.toString())?.name, "Alpha Workflow");

  // Delete Tenant A's workflow with Tenant B's key -> 404
  const deleteRes = await fetch(`${baseUrl}/api/workflows/${workflowAId.toString()}`, {
    method: "DELETE",
    headers: { "x-api-key": keyB.plaintextKey },
  });
  assert.equal(deleteRes.status, 404);
  const deleteData = (await deleteRes.json()) as { error: { code: string } };
  assert.equal(deleteData.error.code, "WORKFLOW_NOT_FOUND");
  // Verify workflow in store was NOT deleted
  assert.ok(workflowsMap.has(workflowAId.toString()));
});

test("6. Execution history and execution resource access remain tenant-scoped", async () => {
  // Tenant B attempts to start execution on Tenant A's workflow -> 404
  const startRes = await fetch(
    `${baseUrl}/api/workflows/${workflowAId.toString()}/executions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": keyB.plaintextKey,
      },
      body: JSON.stringify({ input: {} }),
    },
  );
  assert.equal(startRes.status, 404);

  // Tenant B attempts to list executions for Tenant A's workflow -> 404
  const listExecRes = await fetch(
    `${baseUrl}/api/workflows/${workflowAId.toString()}/executions`,
    {
      headers: { "x-api-key": keyB.plaintextKey },
    },
  );
  assert.equal(listExecRes.status, 404);

  // Tenant B attempts to fetch Tenant A's execution directly by execution ID -> 404
  const getExecRes = await fetch(
    `${baseUrl}/api/executions/${executionAId.toString()}`,
    {
      headers: { "x-api-key": keyB.plaintextKey },
    },
  );
  assert.equal(getExecRes.status, 404);

  // Tenant A can successfully access its own execution
  const ownExecRes = await fetch(
    `${baseUrl}/api/executions/${executionAId.toString()}`,
    {
      headers: { "x-api-key": keyA1.plaintextKey },
    },
  );
  assert.equal(ownExecRes.status, 200);
  const ownExecData = (await ownExecRes.json()) as {
    execution: { _id: string; tenantId: string };
  };
  assert.equal(ownExecData.execution._id, executionAId.toString());
  assert.equal(ownExecData.execution.tenantId, tenantAId.toString());
});

test("7. A client-supplied tenant ID cannot override the authenticated tenant", async () => {
  // Attempting to override tenantId in request body during workflow creation -> rejected with 400
  const bodyOverrideRes = await fetch(`${baseUrl}/api/workflows`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": keyA1.plaintextKey,
    },
    body: JSON.stringify({
      name: "Tenant Spoofing Attempt",
      graph: validGraph,
      tenantId: tenantBId.toString(),
    }),
  });
  assert.equal(bodyOverrideRes.status, 400);
  const bodyOverrideData = (await bodyOverrideRes.json()) as {
    error: { code: string; message: string };
  };
  assert.equal(bodyOverrideData.error.code, "VALIDATION_ERROR");

  // Attempting to override tenant via x-tenant-id header with Key A
  const headerOverrideRes = await fetch(`${baseUrl}/api/test-authenticated-tenant`, {
    headers: {
      "x-api-key": keyA1.plaintextKey,
      "x-tenant-id": tenantBId.toString(),
    },
  });
  assert.equal(headerOverrideRes.status, 200);
  const headerOverrideData = (await headerOverrideRes.json()) as { tenantId: string };
  // Must resolve to Tenant A, NOT Tenant B
  assert.equal(headerOverrideData.tenantId, tenantAId.toString());
  assert.notEqual(headerOverrideData.tenantId, tenantBId.toString());
});

test("8. Invalid, revoked, or expired keys are rejected when applicable", async () => {
  // Missing API key -> 401
  const missingRes = await fetch(`${baseUrl}/api/workflows`);
  assert.equal(missingRes.status, 401);
  const missingData = (await missingRes.json()) as { error: { code: string } };
  assert.equal(missingData.error.code, "UNAUTHORIZED");

  // Unregistered / unknown API key -> 401
  const unregRes = await fetch(`${baseUrl}/api/workflows`, {
    headers: { "x-api-key": unregisteredKey.plaintextKey },
  });
  assert.equal(unregRes.status, 401);
  const unregData = (await unregRes.json()) as { error: { code: string } };
  assert.equal(unregData.error.code, "UNAUTHORIZED");

  // Revoked API key -> 401
  const revokedRes = await fetch(`${baseUrl}/api/workflows`, {
    headers: { "x-api-key": revokedKey.plaintextKey },
  });
  assert.equal(revokedRes.status, 401);
  const revokedData = (await revokedRes.json()) as { error: { code: string } };
  assert.equal(revokedData.error.code, "UNAUTHORIZED");

  // Expired API key -> 401
  const expiredRes = await fetch(`${baseUrl}/api/workflows`, {
    headers: { "x-api-key": expiredKey.plaintextKey },
  });
  assert.equal(expiredRes.status, 401);
  const expiredData = (await expiredRes.json()) as { error: { code: string } };
  assert.equal(expiredData.error.code, "UNAUTHORIZED");
});

test("9. Existing legitimate same-tenant API-key behaviour remains supported", async () => {
  // Key A2 (secondary key for Tenant A) resolves to Tenant A
  const authRes = await fetch(`${baseUrl}/api/test-authenticated-tenant`, {
    headers: { "x-api-key": keyA2.plaintextKey },
  });
  assert.equal(authRes.status, 200);
  const authData = (await authRes.json()) as { tenantId: string };
  assert.equal(authData.tenantId, tenantAId.toString());

  // Key A2 can list Tenant A's workflows
  const listRes = await fetch(`${baseUrl}/api/workflows`, {
    headers: { "x-api-key": keyA2.plaintextKey },
  });
  assert.equal(listRes.status, 200);
  const listData = (await listRes.json()) as { workflows: Array<{ _id: string }> };
  assert.equal(listData.workflows.length, 1);
  assert.equal(listData.workflows[0]._id, workflowAId.toString());

  // Key A2 can retrieve Tenant A's workflow by ID
  const getRes = await fetch(`${baseUrl}/api/workflows/${workflowAId.toString()}`, {
    headers: { "x-api-key": keyA2.plaintextKey },
  });
  assert.equal(getRes.status, 200);
  const getData = (await getRes.json()) as { workflow: { _id: string } };
  assert.equal(getData.workflow._id, workflowAId.toString());
});
