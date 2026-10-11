import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import app from "./app";
import express from "express";
import { errorHandler } from "./middleware/errorHandler.middleware";

let server: Server;
let baseUrl: string;

before(async () => {
  server = app.listen(0, "127.0.0.1");

  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const address = server.address() as AddressInfo;
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

describe("Express app", () => {
    it("rejects an invalid API key", async () => {
      const response = await fetch(`${baseUrl}/api/test-tenant`, {
        headers: { "x-api-key": "invalid-example-key" },
      });

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        error: "Invalid API key",
      });
    });

it("returns a generic response for unexpected errors", async () => {
  const errorApp = express();

  errorApp.get("/error", (_req, _res, next) => {
    next(new Error("private internal detail"));
  });

  errorApp.use(errorHandler);

  const errorServer = errorApp.listen(0, "127.0.0.1");

  try {
    await new Promise<void>((resolve, reject) => {
      errorServer.once("listening", resolve);
      errorServer.once("error", reject);
    });

    const address = errorServer.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/error`);

    const body = await response.text();

    assert.equal(response.status, 500);
    assert.deepEqual(JSON.parse(body), {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
    });
    assert.equal(body.includes("private internal detail"), false);
  } finally {
    await new Promise<void>((resolve, reject) => {
      errorServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

  it("returns a healthy response", async () => {
    const response = await fetch(`${baseUrl}/api/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });

  it("rejects a missing tenant ID", async () => {
    const response = await fetch(`${baseUrl}/api/test-tenant-context`);

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Missing x-tenant-id header",
    });
  });

  it("accepts a valid-format tenant ID", async () => {
    const response = await fetch(`${baseUrl}/api/test-tenant-context`, {
      headers: { "x-tenant-id": "tenant-001" },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      message: "Tenant context resolved",
      tenantId: "tenant-001",
    });
  });

  it("rejects a missing API key", async () => {
    const response = await fetch(`${baseUrl}/api/test-tenant`);

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "Missing API key",
    });
  });
  it("rejects a malformed tenant ID", async () => {
    const response = await fetch(`${baseUrl}/api/test-tenant-context`, {
      headers: { "x-tenant-id": "invalid/tenant" },
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Invalid tenant ID format",
    });
  });
});


