

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { validateRequest } from "./validateRequest.middleware";
import { validateCreateWorkflow } from "../validators/workflow.validator";

let server: Server;
let baseUrl: string;

before(async () => {
  const app = express();

  app.use(express.json());

  app.post(
    "/workflows",
    validateRequest(validateCreateWorkflow),
    (_req, res) => {
      res.status(201).json({
        data: res.locals.validatedBody,
      });
    },
  );

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

describe("validateRequest middleware", () => {
  it("returns 400 for an invalid workflow body", async () => {
    const response = await fetch(`${baseUrl}/workflows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: ["name is required and must be a non-empty string"],
      },
    });
  });

  it("passes normalized data to the next handler", async () => {
    const response = await fetch(`${baseUrl}/workflows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "  Order Processing  ",
        description: "  Process an order  ",
      }),
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      data: {
        name: "Order Processing",
        description: "Process an order",
      },
    });
  });

  it("rejects a client-supplied status", async () => {
    const response = await fetch(`${baseUrl}/workflows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Order Processing",
        status: "active",
      }),
    });

    assert.equal(response.status, 400);

    const body = (await response.json()) as {
      error: { details: string[] };
    };

    assert.ok(body.error.details.some((detail) => detail.includes("status")));
  });
});
