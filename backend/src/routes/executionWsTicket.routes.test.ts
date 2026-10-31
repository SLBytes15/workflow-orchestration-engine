import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { Types } from "mongoose";

import { errorHandler } from "../middleware/errorHandler.middleware";
import type { TenantResolver } from "../services/tenantResolver";
import { createExecutionTicketService } from "../services/executionTicket.service";
import { createExecutionWsTicketRouter } from "./executionWsTicket.routes";

const tenantId = new Types.ObjectId();
const otherTenantId = new Types.ObjectId();

let server: Server;
let baseUrl: string;

const tickets = createExecutionTicketService();

const resolver: TenantResolver = {
  async resolverTenant(apiKey: string) {
    if (apiKey === "valid-test-key") {
      return { tenantId } as NonNullable<
        Awaited<ReturnType<TenantResolver["resolverTenant"]>>
      >;
    }

    if (apiKey === "other-test-key") {
      return { tenantId: otherTenantId } as NonNullable<
        Awaited<ReturnType<TenantResolver["resolverTenant"]>>
      >;
    }

    return null;
  },
};

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/executions", createExecutionWsTicketRouter(resolver, tickets));
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
  tickets.clear();

  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

test("rejects a ticket request without an API key", async () => {
  tickets.clear();

  const response = await fetch(`${baseUrl}/api/executions/ws-ticket`, {
    method: "POST",
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: {
      code: "UNAUTHORIZED",
      message: "A valid API key is required",
    },
  });
  assert.equal(tickets.size(), 0);
});

test("rejects a ticket request with an unknown API key", async () => {
  tickets.clear();

  const response = await fetch(`${baseUrl}/api/executions/ws-ticket`, {
    method: "POST",
    headers: { "x-api-key": "invalid-test-key" },
  });

  assert.equal(response.status, 401);
  assert.equal(tickets.size(), 0);
});

test("issues a ticket bound to the authenticated tenant only", async () => {
  tickets.clear();

  const response = await fetch(`${baseUrl}/api/executions/ws-ticket`, {
    method: "POST",
    headers: { "x-api-key": "valid-test-key" },
  });

  assert.equal(response.status, 200);

  const payload = (await response.json()) as Record<string, unknown>;

  // The approved response shape carries the ticket and its expiry only.
  assert.deepEqual(Object.keys(payload).sort(), ["expiresAt", "ticket"]);
  assert.equal(typeof payload.ticket, "string");
  assert.equal(typeof payload.expiresAt, "string");

  const expiresAt = Date.parse(String(payload.expiresAt));
  assert.ok(Number.isFinite(expiresAt));
  assert.ok(expiresAt > Date.now());

  // The ticket is bound server-side to the tenant resolved from the API key.
  assert.deepEqual(tickets.consume(payload.ticket), {
    tenantId: String(tenantId),
  });
});

test("ignores a client-supplied tenant ID in the request body", async () => {
  tickets.clear();

  const response = await fetch(`${baseUrl}/api/executions/ws-ticket`, {
    method: "POST",
    headers: {
      "x-api-key": "valid-test-key",
      "content-type": "application/json",
    },
    body: JSON.stringify({ tenantId: String(otherTenantId) }),
  });

  assert.equal(response.status, 200);

  const payload = (await response.json()) as { ticket: string };

  assert.deepEqual(tickets.consume(payload.ticket), {
    tenantId: String(tenantId),
  });
});

test("binds each ticket to its own tenant across two API keys", async () => {
  tickets.clear();

  const first = await fetch(`${baseUrl}/api/executions/ws-ticket`, {
    method: "POST",
    headers: { "x-api-key": "valid-test-key" },
  });
  const second = await fetch(`${baseUrl}/api/executions/ws-ticket`, {
    method: "POST",
    headers: { "x-api-key": "other-test-key" },
  });

  const firstTicket = ((await first.json()) as { ticket: string }).ticket;
  const secondTicket = ((await second.json()) as { ticket: string }).ticket;

  assert.notEqual(firstTicket, secondTicket);
  assert.deepEqual(tickets.consume(firstTicket), {
    tenantId: String(tenantId),
  });
  assert.deepEqual(tickets.consume(secondTicket), {
    tenantId: String(otherTenantId),
  });
});
