import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { Types } from "mongoose";
import { WebSocket } from "ws";

import {
  createExecutionService,
  type ExecutionServiceDependencies,
} from "./execution.service";
import { executionEventHub } from "./executionWebSocket";
import { executionTicketService } from "./executionTicket.service";

const tenantId = new Types.ObjectId();
const otherTenantId = new Types.ObjectId();
const workflowId = new Types.ObjectId();
const executionId = new Types.ObjectId();

const TENANT = String(tenantId);
const OTHER_TENANT = String(otherTenantId);

const graph = { version: 1 as const, nodes: [], edges: [] };
const workflow = { _id: workflowId, tenantId, version: 1, graph };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await delay(10);
  }

  throw new Error(`Timed out waiting for: ${message}`);
}

/**
 * End-to-end proof of the approved publish-after-persistence contract: a real
 * persisted execution transition reaches a real WebSocket client, and only the
 * owning tenant receives it.
 */
test("streams persisted execution transitions to the owning tenant only", async () => {
  const server: Server = createServer();

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Could not determine test server address");
  }

  executionEventHub.attach(server);
  const url = `ws://127.0.0.1:${address.port}/ws/executions`;

  const dependencies: ExecutionServiceDependencies = {
    findWorkflow: async () => workflow,
    createExecution: async (record) => ({ ...record, _id: executionId }),
    updateExecution: async (_tenant, _id, _expectedStatus, _results, update) => ({
      _id: executionId,
      tenantId,
      workflowId,
      workflowVersion: 1,
      graphSnapshot: graph,
      ...update,
    }),
    findExecution: async () => null,
    findHistory: async () => [],
  };

  const ownerSocket = new WebSocket(
    `${url}?ticket=${executionTicketService.issue(TENANT).ticket}`,
  );
  const otherSocket = new WebSocket(
    `${url}?ticket=${executionTicketService.issue(OTHER_TENANT).ticket}`,
  );

  await Promise.all([
    new Promise<void>((resolve, reject) => {
      ownerSocket.once("open", () => resolve());
      ownerSocket.once("error", reject);
    }),
    new Promise<void>((resolve, reject) => {
      otherSocket.once("open", () => resolve());
      otherSocket.once("error", reject);
    }),
  ]);

  const ownerEvents: Array<{ type: string; data: { status: string } }> = [];
  const otherEvents: unknown[] = [];

  ownerSocket.on("message", (data) =>
    ownerEvents.push(JSON.parse(String(data))),
  );
  otherSocket.on("message", (data) =>
    otherEvents.push(JSON.parse(String(data))),
  );

  try {
    await waitUntil(
      () =>
        executionEventHub.connectionCount(TENANT) === 1 &&
        executionEventHub.connectionCount(OTHER_TENANT) === 1,
      "both tenant sockets registered",
    );

    // An invalid graph still produces real persisted transitions, so the
    // notification path is exercised without touching a database.
    const service = createExecutionService(dependencies);
    const result = await service.startExecution(tenantId, String(workflowId));

    assert.equal(result.status, "failed");

    await waitUntil(() => ownerEvents.length === 2, "two owner events");
    await delay(150);

    assert.deepEqual(
      ownerEvents.map((event) => [event.type, event.data.status]),
      [
        ["execution.updated", "running"],
        ["execution.failed", "failed"],
      ],
    );
    assert.deepEqual(otherEvents, []);
  } finally {
    ownerSocket.close();
    otherSocket.close();
    await executionEventHub.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
