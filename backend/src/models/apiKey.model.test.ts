
import assert from "node:assert/strict";
import { test } from "node:test";
import ApiKeyModel from "./apiKey.model";


test("requires tenantId, keyHash, and keyPrefix", async () => {
  const apiKey = new ApiKeyModel({});

  await assert.rejects(apiKey.validate(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok("errors" in error);

    const validationError = error as {
      errors: Record<string, unknown>;
    };

    assert.ok(validationError.errors.tenantId);
    assert.ok(validationError.errors.keyHash);
    assert.ok(validationError.errors.keyPrefix);

    return true;
  });
});


test("applies active status by default", () => {
  const apiKey = new ApiKeyModel({
    tenantId: "507f1f77bcf86cd799439011",
    keyHash: "test-hash",
    keyPrefix: "zaal_test",
  });

  assert.equal(apiKey.status, "active");
});


test("accepts only active or revoked status", async () => {
  const apiKey = new ApiKeyModel({
    tenantId: "507f1f77bcf86cd799439011",
    keyHash: "test-hash",
    keyPrefix: "zaal_test",
    status: "invalid",
  });

  await assert.rejects(apiKey.validate(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok("errors" in error);

    const validationError = error as {
      errors: Record<string, unknown>;
    };

    assert.ok(validationError.errors.status);

    return true;
  });
});


test("references Tenant through tenantId", () => {
  const path = ApiKeyModel.schema.path("tenantId") as {
    options: { ref?: string };
  };

  assert.equal(path.options.ref, "Tenant");
});

test("declares a unique index on keyHash", () => {
  const indexes = ApiKeyModel.schema.indexes();

  assert.ok(
    indexes.some(
      ([fields, options]) =>
        fields.keyHash === 1 && options?.unique === true,
    ),
  );
});

test("enables timestamps", () => {
  assert.equal(ApiKeyModel.schema.options.timestamps, true);
});

test("defaults expiry and revocation time to null", () => {
  const apiKey = new ApiKeyModel({
    tenantId: "507f1f77bcf86cd799439011",
    keyHash: "test-hash",
    keyPrefix: "zaal_test",
  });

  assert.equal(apiKey.expiresAt, null);
  assert.equal(apiKey.revokedAt, null);
});
