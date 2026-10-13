import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";

import {
  createApiKeyManagementService,
  type ApiKeyManagementDependencies,
} from "./apiKeyManagement.service";

function setup(tenantIsActive = true) {
  const tenantId = new Types.ObjectId();
  const storedRecords: Array<Record<string, unknown>> = [];
  const revokedRecords: Array<{
    keyId: string;
    tenantId: Types.ObjectId;
    revokedAt: Date;
  }> = [];

  const dependencies: ApiKeyManagementDependencies = {
    async findActiveTenant(id) {
      return tenantIsActive && id.equals(tenantId);
    },

    async createKeyRecord(record) {
      storedRecords.push(record);
      return { id: new Types.ObjectId().toString() };
    },

    async revokeKeyRecord(keyId, id, revokedAt) {
      if (!id.equals(tenantId)) return false;

      revokedRecords.push({ keyId, tenantId: id, revokedAt });
      return true;
    },
  };

  return {
    tenantId,
    storedRecords,
    revokedRecords,
    service: createApiKeyManagementService(dependencies),
  };
}

test("creates a key and stores only its hash", async () => {
  const context = setup();

  const result = await context.service.createKey({
    tenantId: context.tenantId,
  });

  assert.ok(result.plaintextKey);
  assert.ok(result.keyPrefix);
  assert.ok(result.id);

  assert.equal(context.storedRecords.length, 1);

  const stored = context.storedRecords[0];

  assert.equal(stored.tenantId, context.tenantId);
  assert.equal(stored.status, "active");
  assert.equal(stored.revokedAt, null);
  assert.equal(typeof stored.keyHash, "string");
  assert.match(stored.keyHash as string, /^[a-f0-9]{64}$/);
  assert.notEqual(stored.keyHash, result.plaintextKey);
  assert.equal("plaintextKey" in stored, false);
});

test("stores the hash that corresponds to the returned key", async () => {
  const context = setup();

  const result = await context.service.createKey({
    tenantId: context.tenantId,
  });

  const { hashApiKey } = await import("./apiKeyCrypto.js");

  assert.equal(
    context.storedRecords[0].keyHash,
    hashApiKey(result.plaintextKey),
  );
});

test("rejects creation for an inactive tenant", async () => {
  const context = setup(false);

  await assert.rejects(
    context.service.createKey({ tenantId: context.tenantId }),
    /Active tenant not found/,
  );

  assert.equal(context.storedRecords.length, 0);
});

test("rejects an expiry date in the past", async () => {
  const context = setup();

  await assert.rejects(
    context.service.createKey({
      tenantId: context.tenantId,
      expiresAt: new Date(Date.now() - 1000),
    }),
    /future date/,
  );

  assert.equal(context.storedRecords.length, 0);
});

test("accepts a future expiry date", async () => {
  const context = setup();
  const expiresAt = new Date(Date.now() + 60_000);

  const result = await context.service.createKey({
    tenantId: context.tenantId,
    expiresAt,
  });

  assert.equal(result.expiresAt?.getTime(), expiresAt.getTime());
  assert.equal(context.storedRecords[0].expiresAt, expiresAt);
});

test("revokes a key through the scoped dependency", async () => {
  const context = setup();
  const keyId = new Types.ObjectId().toString();

  const revoked = await context.service.revokeKey(keyId, context.tenantId);

  assert.equal(revoked, true);
  assert.equal(context.revokedRecords.length, 1);
  assert.equal(context.revokedRecords[0].keyId, keyId);
  assert.ok(context.revokedRecords[0].revokedAt instanceof Date);
});

test("rejects an invalid key ID for revocation", async () => {
  const context = setup();

  const revoked = await context.service.revokeKey(
    "not-an-object-id",
    context.tenantId,
  );

  assert.equal(revoked, false);
  assert.equal(context.revokedRecords.length, 0);
});
