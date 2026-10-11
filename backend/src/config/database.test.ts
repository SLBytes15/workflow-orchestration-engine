import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import mongoose from "mongoose";
import { connectDatabase } from "./database";

afterEach(() => {
  mock.restoreAll();
});

describe("connectDatabase", () => {
  it("rejects when MONGODB_URI is missing", async () => {
    await assert.rejects(
      connectDatabase(""),
      /MONGODB_URI is not configured/,
    );
  });

  it("rejects when MONGODB_URI contains only whitespace", async () => {
    await assert.rejects(
      connectDatabase("   "),
      /MONGODB_URI is not configured/,
    );
  });

  it("propagates MongoDB connection failures", async () => {
    const expectedError = new Error("Simulated connection failure");

    mock.method(mongoose, "connect", async () => {
      throw expectedError;
    });

    await assert.rejects(
      connectDatabase("mongodb://example.invalid/test"),
      (error: unknown) => error === expectedError,
    );
  });
});
