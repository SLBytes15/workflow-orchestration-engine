import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { Types } from "mongoose";

import { tenantAuthMiddleware } from "./tenantAuth.middleware";
import type { TenantResolver } from "../services/tenantResolver";

const tenantId = new Types.ObjectId();

const validResolver: TenantResolver = {
  async resolverTenant(apiKey: string) {
    if (apiKey !== "test-valid-key") {
      return null;
    }

    return { tenantId };
  },
};

let server: Server;
let baseUrl: string;

before(async () => {
  const app = express();

  app.use(tenantAuthMiddleware(validResolver));

  app.get("/protected", (req, res) => {
    res.json({
      tenantId: req.tenantContext?.tenantId.toString(),
    });
  });

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
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
});

test("does not trust a client-supplied x-tenant-id", async () => {
  const response = await fetch(`${baseUrl}/protected`, {
    headers: {
      "x-api-key": "test-valid-key",
      "x-tenant-id": "attacker-selected-tenant",
    },
  });

  assert.equal(response.status, 200);

  const body = await response.json();

  // The trusted tenant must come from the resolver,
  // not from the client-supplied header.
  assert.equal(body.tenantId, tenantId.toString());
  assert.notEqual(body.tenantId, "attacker-selected-tenant");
});

test("rejects a key that cannot be resolved to a tenant", async () => {
  const unresolvedResolver: TenantResolver = {
    async resolverTenant() {
      return null;
    },
  };

  const app = express();
  app.use(tenantAuthMiddleware(unresolvedResolver));

  const testServer = app.listen(0, "127.0.0.1");

  try {
    await new Promise<void>((resolve) => testServer.once("listening", resolve));

    const address = testServer.address();

    if (!address || typeof address === "string") {
      throw new Error("Could not determine test server address");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/protected`, {
      headers: { "x-api-key": "unmapped-key" },
    });

    assert.equal(response.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) =>
      testServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
test("forwards tenant resolver errors to Express error handling", async () => {
  const failingResolver: TenantResolver = {
    async resolverTenant() {
      throw new Error("Simulated resolver failure");
    },
  };

  const app = express();

  app.use(tenantAuthMiddleware(failingResolver));

  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal server error",
        },
      });
    },
  );

  const testServer = app.listen(0, "127.0.0.1");

  try {
    await new Promise<void>((resolve) => testServer.once("listening", resolve));

    const address = testServer.address();

    if (!address || typeof address === "string") {
      throw new Error("Could not determine test server address");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/protected`, {
      headers: { "x-api-key": "test-valid-key" },
    });

    assert.equal(response.status, 500);

    const body = await response.json();
    assert.equal(body.error.code, "INTERNAL_ERROR");
  } finally {
    await new Promise<void>((resolve, reject) =>
      testServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("rejects a missing API key", async () => {
  const response = await fetch(`${baseUrl}/protected`);

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "UNAUTHORIZED");
});

test("rejects an invalid API key", async () => {
  const response = await fetch(`${baseUrl}/protected`, {
    headers: { "x-api-key": "invalid-key" },
  });

  assert.equal(response.status, 401);
});

test("attaches the resolved tenant context for a valid key", async () => {
  const response = await fetch(`${baseUrl}/protected`, {
    headers: { "x-api-key": "test-valid-key" },
  });

  assert.equal(response.status, 200);

  const body = await response.json();

  assert.equal(body.tenantId, tenantId.toString());
});
