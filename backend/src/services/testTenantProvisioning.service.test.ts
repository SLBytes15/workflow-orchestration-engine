import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import TenantModel from "../models/tenant.model";
import {
  createApiKeyManagementService,
  type ApiKeyManagementDependencies,
} from "./apiKeyManagement.service";
import {
  createTenantResolver,
  type TenantResolverDependencies,
} from "./tenantResolver";
import { hashApiKey } from "./apiKeyCrypto";
import {
  assertTestTenantSeedDatabase,
  assertTestTenantSeedEnvironment,
  MAHAK_TEST_TENANTS,
  provisionMahakTestTenants,
  type ProvisionedApiKey,
  type ProvisionedTenant,
  type TestTenantProvisioningDependencies,
} from "./testTenantProvisioning.service";

type StoredKey = {
  id: string;
  tenantId: Types.ObjectId;
  keyHash: string;
  keyPrefix: string;
  status: "active" | "revoked";
  expiresAt: Date | null;
  revokedAt: Date | null;
};

function createHarness(options: {
  failResolution?: boolean;
  duplicateTenantIds?: boolean;
  wrongKeyTenantAssociation?: boolean;
  failKeyRollback?: boolean;
} = {}) {
  const tenants: ProvisionedTenant[] = [];
  const keys: StoredKey[] = [];

  const apiKeyDependencies: ApiKeyManagementDependencies = {
    async findActiveTenant(tenantId) {
      return tenants.some(
        (tenant) => tenant.id.equals(tenantId) && tenant.status === "active",
      );
    },
    async createKeyRecord(record) {
      const id = new Types.ObjectId().toString();
      keys.push({
        id,
        ...record,
      });
      return { id };
    },
    async revokeKeyRecord(keyId, tenantId) {
      const key = keys.find(
        (candidate) =>
          candidate.id === keyId && candidate.tenantId.equals(tenantId),
      );
      if (!key) return false;
      key.status = "revoked";
      key.revokedAt = new Date();
      return true;
    },
  };
  const keyManagement = createApiKeyManagementService(apiKeyDependencies);

  const resolverDependencies: TenantResolverDependencies = {
    async findApiKeyByHash(keyHash) {
      const key = keys.find((candidate) => candidate.keyHash === keyHash);
      return key
        ? {
            tenantId: key.tenantId,
            status: key.status,
            expiresAt: key.expiresAt,
            revokedAt: key.revokedAt,
          }
        : null;
    },
    async findTenantById(tenantId) {
      const tenant = tenants.find((candidate) =>
        candidate.id.equals(tenantId),
      );
      return tenant
        ? { _id: tenant.id, status: tenant.status }
        : null;
    },
  };
  const tenantResolver = createTenantResolver(resolverDependencies);

  const dependencies: TestTenantProvisioningDependencies = {
    async findTenantBySlug(slug) {
      return tenants.find((tenant) => tenant.slug === slug) ?? null;
    },
    async createTenant(input) {
      const tenant: ProvisionedTenant = {
        id:
          options.duplicateTenantIds && tenants.length > 0
            ? tenants[0].id
            : new Types.ObjectId(),
        ...input,
        status: "active",
      };
      tenants.push(tenant);
      return tenant;
    },
    async hasActiveApiKey(tenantId) {
      return keys.some(
        (key) =>
          key.tenantId.equals(tenantId) &&
          key.status === "active" &&
          key.revokedAt === null,
      );
    },
    async createApiKey(tenantId): Promise<ProvisionedApiKey> {
      const created = await keyManagement.createKey({ tenantId });
      return {
        id: created.id,
        tenantId: options.wrongKeyTenantAssociation
          ? new Types.ObjectId()
          : created.tenantId,
        keyPrefix: created.keyPrefix,
        plaintextKey: created.plaintextKey,
      };
    },
    async resolveApiKey(apiKey) {
      if (options.failResolution) return null;
      return tenantResolver.resolverTenant(apiKey);
    },
    async deleteCreatedApiKey(keyId, tenantId) {
      if (options.failKeyRollback) {
        throw new Error("Simulated key rollback failure");
      }

      const index = keys.findIndex(
        (key) => key.id === keyId && key.tenantId.equals(tenantId),
      );
      if (index === -1) throw new Error("Created key not found for rollback");
      keys.splice(index, 1);
    },
    async deleteCreatedTenant(tenantId, slug) {
      const index = tenants.findIndex(
        (tenant) => tenant.id.equals(tenantId) && tenant.slug === slug,
      );
      if (index === -1) {
        throw new Error("Created tenant not found for rollback");
      }
      tenants.splice(index, 1);
    },
  };

  return { tenants, keys, dependencies };
}

test("creates distinct tenants and keys that resolve only to their tenant", async () => {
  const harness = createHarness();

  const results = await provisionMahakTestTenants(harness.dependencies);

  assert.equal(results.length, 2);
  assert.notEqual(results[0].tenant.id.toString(), results[1].tenant.id.toString());
  assert.ok(results[0].apiKey);
  assert.ok(results[1].apiKey);
  assert.notEqual(
    results[0].apiKey.plaintextKey,
    results[1].apiKey.plaintextKey,
  );

  for (const result of results) {
    const key = result.apiKey;
    assert.ok(key);
    const record = harness.keys.find((candidate) => candidate.id === key.id);
    assert.ok(record);
    assert.equal(record.tenantId.toString(), result.tenant.id.toString());
    assert.equal(record.keyHash, hashApiKey(key.plaintextKey));
    assert.notEqual(record.keyHash, key.plaintextKey);
    assert.equal(
      Object.values(record).includes(key.plaintextKey),
      false,
      "plaintext API key must not be stored",
    );

    const resolved = await harness.dependencies.resolveApiKey(key.plaintextKey);
    assert.equal(resolved?.tenantId.toString(), result.tenant.id.toString());
  }
});

test("rerunning reuses active keys and leaves unrelated tenant records untouched", async () => {
  const harness = createHarness();
  const unrelatedTenant = await harness.dependencies.createTenant({
    name: "Unrelated tenant",
    slug: "unrelated-tenant",
  });
  const unrelatedKey = await harness.dependencies.createApiKey(
    unrelatedTenant.id,
  );
  const unrelatedKeyHash = hashApiKey(unrelatedKey.plaintextKey);

  await provisionMahakTestTenants(harness.dependencies);
  const tenantCount = harness.tenants.length;
  const keyCount = harness.keys.length;
  const secondRun = await provisionMahakTestTenants(harness.dependencies);

  assert.equal(harness.tenants.length, tenantCount);
  assert.equal(harness.keys.length, keyCount);
  assert.ok(secondRun.every((result) => result.keyAlreadyExisted));
  assert.ok(secondRun.every((result) => result.apiKey === null));
  assert.ok(
    harness.tenants.some((tenant) => tenant.id.equals(unrelatedTenant.id)),
  );
  assert.ok(
    harness.keys.some(
      (key) =>
        key.tenantId.equals(unrelatedTenant.id) &&
        key.keyHash === unrelatedKeyHash &&
        key.status === "active",
    ),
  );
});

test("reuses matching tenants without deleting them", async () => {
  const harness = createHarness();
  const existing = [];

  for (const definition of MAHAK_TEST_TENANTS) {
    existing.push(await harness.dependencies.createTenant(definition));
  }

  const results = await provisionMahakTestTenants(harness.dependencies);

  assert.deepEqual(
    results.map((result) => result.tenant.id.toString()),
    existing.map((tenant) => tenant.id.toString()),
  );
  assert.equal(harness.tenants.length, 2);
  assert.ok(existing.every((tenant) => harness.tenants.includes(tenant)));
});

test("rejects existing tenants with unexpected metadata without deleting them", async () => {
  const harness = createHarness();
  const firstCreated = await harness.dependencies.createTenant(
    MAHAK_TEST_TENANTS[0],
  );
  const conflicting = await harness.dependencies.createTenant(
    MAHAK_TEST_TENANTS[1],
  );
  conflicting.name = "Unexpected name";

  await assert.rejects(
    provisionMahakTestTenants(harness.dependencies),
    /unexpected metadata/,
  );

  assert.ok(harness.tenants.includes(firstCreated));
  assert.ok(harness.tenants.includes(conflicting));
  assert.equal(harness.keys.length, 0);
});

test("does not claim to recover or return an existing active key's plaintext", async () => {
  const harness = createHarness();
  const existing = await harness.dependencies.createTenant(
    MAHAK_TEST_TENANTS[0],
  );
  const oldKey = await harness.dependencies.createApiKey(existing.id);

  const results = await provisionMahakTestTenants(harness.dependencies);
  const reusedTenant = results.find((result) =>
    result.tenant.id.equals(existing.id),
  );

  assert.ok(reusedTenant);
  assert.equal(reusedTenant.keyAlreadyExisted, true);
  assert.equal(reusedTenant.apiKey, null);
  assert.ok(
    harness.keys.some((key) => key.keyHash === hashApiKey(oldKey.plaintextKey)),
  );
});

test("rolls back only records created by this run after verification fails", async () => {
  const harness = createHarness({ failResolution: true });

  await assert.rejects(
    provisionMahakTestTenants(harness.dependencies),
    /did not resolve to its tenant/,
  );

  assert.deepEqual(harness.tenants, []);
  assert.deepEqual(harness.keys, []);
});

test("preserves pre-existing tenant and key records when later provisioning fails", async () => {
  const harness = createHarness({ failResolution: true });
  const existingTenant = await harness.dependencies.createTenant(
    MAHAK_TEST_TENANTS[0],
  );
  const existingKey = await harness.dependencies.createApiKey(
    existingTenant.id,
  );

  await assert.rejects(
    provisionMahakTestTenants(harness.dependencies),
    /did not resolve to its tenant/,
  );

  assert.deepEqual(harness.tenants, [existingTenant]);
  assert.equal(harness.keys.length, 1);
  assert.equal(harness.keys[0].id, existingKey.id);
  assert.equal(
    harness.keys[0].keyHash,
    hashApiKey(existingKey.plaintextKey),
  );
});

test("rejects duplicate tenant IDs and rolls back only tenants created by the run", async () => {
  const harness = createHarness({ duplicateTenantIds: true });

  await assert.rejects(
    provisionMahakTestTenants(harness.dependencies),
    /distinct IDs/,
  );

  assert.deepEqual(harness.tenants, []);
  assert.deepEqual(harness.keys, []);
});

test("rejects a key reported for the wrong tenant and scopes rollback to its intended tenant", async () => {
  const harness = createHarness({ wrongKeyTenantAssociation: true });

  await assert.rejects(
    provisionMahakTestTenants(harness.dependencies),
    /associated with the wrong tenant/,
  );

  assert.deepEqual(harness.tenants, []);
  assert.deepEqual(harness.keys, []);
});

test("preserves the original failure when key rollback also fails", async () => {
  const harness = createHarness({
    failResolution: true,
    failKeyRollback: true,
  });

  await assert.rejects(
    provisionMahakTestTenants(harness.dependencies),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /rollback was incomplete/);
      assert.match(
        String(error.errors[0]),
        /did not resolve to its tenant/,
      );
      assert.match(String(error.errors[1]), /Simulated key rollback failure/);
      return true;
    },
  );

  assert.equal(
    harness.tenants.length,
    2,
    "keep newly created tenants if key cleanup failed",
  );
  assert.equal(harness.keys.length, 1);
});

test("requires test mode, explicit opt-in, and a configured URI", () => {
  const validEnvironment = {
    NODE_ENV: "test",
    ALLOW_TEST_TENANT_SEED: "true",
    MONGODB_URI: "mongodb://localhost/test",
  };

  assert.doesNotThrow(() =>
    assertTestTenantSeedEnvironment(validEnvironment),
  );
  assert.throws(
    () =>
      assertTestTenantSeedEnvironment({
        ...validEnvironment,
        NODE_ENV: "production",
      }),
    /NODE_ENV must be exactly "test"/,
  );
  assert.throws(
    () =>
      assertTestTenantSeedEnvironment({
        ...validEnvironment,
        ALLOW_TEST_TENANT_SEED: undefined,
      }),
    /ALLOW_TEST_TENANT_SEED=true/,
  );
  assert.throws(
    () =>
      assertTestTenantSeedEnvironment({
        ...validEnvironment,
        MONGODB_URI: " ",
      }),
    /MONGODB_URI is not configured/,
  );
  assert.throws(
    () =>
      assertTestTenantSeedEnvironment({
        NODE_ENV: "test",
        ALLOW_TEST_TENANT_SEED: "true",
      }),
    /MONGODB_URI is not configured/,
  );
});

test("requires the connected Mongo database name to be exactly test", () => {
  assert.doesNotThrow(() => assertTestTenantSeedDatabase("test"));
  assert.throws(
    () => assertTestTenantSeedDatabase("workflow_engine_dev"),
    /must be exactly "test"/,
  );
});

test("uses the two explicitly named tenant records", async () => {
  assert.deepEqual(
    MAHAK_TEST_TENANTS.map(({ name, slug }) => ({ name, slug })),
    [
      {
        name: "Mahak Test Tenant A",
        slug: "mahak-test-tenant-a",
      },
      {
        name: "Mahak Test Tenant B",
        slug: "mahak-test-tenant-b",
      },
    ],
  );

  for (const tenant of MAHAK_TEST_TENANTS) {
    const model = new TenantModel({ ...tenant, status: "active" });
    await assert.doesNotReject(model.validate());
  }
});
