import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";

import {
  createTenantResolver,
  type TenantResolverDependencies,
} from "./tenantResolver";
import { generateApiKey } from "./apiKeyCrypto";

function setup(
  overrides: {
    key?: Record<string, unknown> | null;
    tenant?: Record<string, unknown> | null;
  } = {},
) {
  const tenantId = new Types.ObjectId();
  const generated = generateApiKey();

  const key = {
    tenantId,
    status: "active",
    expiresAt: null,
    revokedAt: null,
    ...overrides.key,
  };

  const tenant = {
    _id: tenantId,
    status: "active",
    ...overrides.tenant,
  };

  let lookedUpHash: string | undefined;

  const dependencies: TenantResolverDependencies = {
    async findApiKeyByHash(hash) {
      lookedUpHash = hash;
      return overrides.key === null ? null : (key as never);
    },

    async findTenantById() {
      return overrides.tenant === null ? null : (tenant as never);
    },
  };

  return {
    tenantId,
    generated,
    dependencies,
    getLookedUpHash: () => lookedUpHash,
  };
}

test("resolves a valid key to an active tenant", async () => {
  const context = setup();
  const resolver = createTenantResolver(context.dependencies);

  const result = await resolver.resolverTenant(context.generated.plaintextKey);

  assert.equal(result?.tenantId.toString(), context.tenantId.toString());
  assert.equal(context.getLookedUpHash(), context.generated.keyHash);
});

test("returns null for an unknown key", async () => {
  const context = setup({ key: null });
  const resolver = createTenantResolver(context.dependencies);

  assert.equal(
    await resolver.resolverTenant(context.generated.plaintextKey),
    null,
  );
});

test("rejects a revoked key", async () => {
  const context = setup({
    key: { status: "revoked" },
  });
  const resolver = createTenantResolver(context.dependencies);

  assert.equal(
    await resolver.resolverTenant(context.generated.plaintextKey),
    null,
  );
});

test("rejects a key with a revocation timestamp", async () => {
  const context = setup({
    key: { revokedAt: new Date() },
  });
  const resolver = createTenantResolver(context.dependencies);

  assert.equal(
    await resolver.resolverTenant(context.generated.plaintextKey),
    null,
  );
});

test("rejects an expired key", async () => {
  const context = setup({
    key: { expiresAt: new Date(Date.now() - 1000) },
  });
  const resolver = createTenantResolver(context.dependencies);

  assert.equal(
    await resolver.resolverTenant(context.generated.plaintextKey),
    null,
  );
});

test("rejects a missing tenant", async () => {
  const context = setup({ tenant: null });
  const resolver = createTenantResolver(context.dependencies);

  assert.equal(
    await resolver.resolverTenant(context.generated.plaintextKey),
    null,
  );
});

test("rejects an inactive tenant", async () => {
  const context = setup({
    tenant: { status: "inactive" },
  });
  const resolver = createTenantResolver(context.dependencies);

  assert.equal(
    await resolver.resolverTenant(context.generated.plaintextKey),
    null,
  );
});

test("rejects an empty API key", async () => {
  const context = setup();
  const resolver = createTenantResolver(context.dependencies);

  assert.equal(await resolver.resolverTenant("   "), null);
});
