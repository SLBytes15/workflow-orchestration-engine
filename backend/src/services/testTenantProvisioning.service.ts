import { Types } from "mongoose";

export const MAHAK_TEST_TENANTS = [
  { name: "Mahak Test Tenant A", slug: "mahak-test-tenant-a" },
  { name: "Mahak Test Tenant B", slug: "mahak-test-tenant-b" },
] as const;

export interface ProvisionedTenant {
  id: Types.ObjectId;
  name: string;
  slug: string;
  status: "active" | "inactive";
}

export interface ProvisionedApiKey {
  id: string;
  tenantId: Types.ObjectId;
  keyPrefix: string;
  plaintextKey: string;
}

export interface TestTenantProvisioningDependencies {
  findTenantBySlug(slug: string): Promise<ProvisionedTenant | null>;
  createTenant(input: {
    name: string;
    slug: string;
  }): Promise<ProvisionedTenant>;
  hasActiveApiKey(tenantId: Types.ObjectId): Promise<boolean>;
  createApiKey(tenantId: Types.ObjectId): Promise<ProvisionedApiKey>;
  resolveApiKey(apiKey: string): Promise<{ tenantId: Types.ObjectId } | null>;
  deleteCreatedApiKey(
    keyId: string,
    tenantId: Types.ObjectId,
  ): Promise<void>;
  deleteCreatedTenant(
    tenantId: Types.ObjectId,
    slug: string,
  ): Promise<void>;
}

export interface TestTenantProvisioningResult {
  tenant: Omit<ProvisionedTenant, "status">;
  apiKey:
    | { id: string; keyPrefix: string; plaintextKey: string }
    | null;
  keyAlreadyExisted: boolean;
}

export function assertTestTenantSeedEnvironment(
  environment: Record<string, string | undefined>,
): void {
  if (environment.NODE_ENV !== "test") {
    throw new Error('NODE_ENV must be exactly "test" to seed test tenants.');
  }

  if (environment.ALLOW_TEST_TENANT_SEED !== "true") {
    throw new Error(
      'Set ALLOW_TEST_TENANT_SEED=true to explicitly enable test tenant seeding.',
    );
  }

  if (!environment.MONGODB_URI?.trim()) {
    throw new Error("MONGODB_URI is not configured.");
  }
}

export function assertTestTenantSeedDatabase(databaseName: string): void {
  if (databaseName !== "test") {
    throw new Error(
      `Refusing to seed database "${databaseName || "(unnamed)"}"; the connected database must be exactly "test".`,
    );
  }
}

export async function provisionMahakTestTenants(
  dependencies: TestTenantProvisioningDependencies,
): Promise<TestTenantProvisioningResult[]> {
  const tenants: ProvisionedTenant[] = [];
  const createdTenants: ProvisionedTenant[] = [];
  const createdKeys: Array<{
    id: string;
    tenantId: Types.ObjectId;
    plaintextKey: string;
  }> = [];

  try {
    for (const definition of MAHAK_TEST_TENANTS) {
      const existing = await dependencies.findTenantBySlug(definition.slug);

      if (
        existing &&
        (existing.name !== definition.name ||
          existing.slug !== definition.slug ||
          existing.status !== "active")
      ) {
        throw new Error(
          `Tenant slug "${definition.slug}" already exists with unexpected metadata; review it manually.`,
        );
      }

      if (existing) {
        tenants.push(existing);
      } else {
        const created = await dependencies.createTenant(definition);
        tenants.push(created);
        createdTenants.push(created);
      }
    }

    if (tenants[0].id.equals(tenants[1].id)) {
      throw new Error("The two test tenant records must have distinct IDs.");
    }

    const results: TestTenantProvisioningResult[] = [];

    for (const [index, tenant] of tenants.entries()) {
      const definition = MAHAK_TEST_TENANTS[index];
      const hasActiveKey = await dependencies.hasActiveApiKey(tenant.id);

      if (hasActiveKey) {
        results.push({
          tenant: {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
          },
          apiKey: null,
          keyAlreadyExisted: true,
        });
        continue;
      }

      const created = await dependencies.createApiKey(tenant.id);
      const duplicatePlaintextKey = createdKeys.some(
        (key) => key.plaintextKey === created.plaintextKey,
      );
      createdKeys.push({
        id: created.id,
        tenantId: tenant.id,
        plaintextKey: created.plaintextKey,
      });

      if (!created.tenantId.equals(tenant.id)) {
        throw new Error(
          `The API key for "${definition.name}" was associated with the wrong tenant.`,
        );
      }

      if (duplicatePlaintextKey) {
        throw new Error("The generated test tenant API keys must be unique.");
      }

      const resolved = await dependencies.resolveApiKey(created.plaintextKey);
      if (!resolved?.tenantId.equals(tenant.id)) {
        throw new Error(
          `The generated API key for "${definition.name}" did not resolve to its tenant.`,
        );
      }

      results.push({
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
        },
        apiKey: {
          id: created.id,
          keyPrefix: created.keyPrefix,
          plaintextKey: created.plaintextKey,
        },
        keyAlreadyExisted: false,
      });
    }

    return results;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    let keyRollbackFailed = false;

    for (const key of createdKeys.reverse()) {
      try {
        await dependencies.deleteCreatedApiKey(key.id, key.tenantId);
      } catch (rollbackError) {
        keyRollbackFailed = true;
        rollbackErrors.push(rollbackError);
      }
    }

    if (!keyRollbackFailed) {
      for (const tenant of createdTenants.reverse()) {
        try {
          await dependencies.deleteCreatedTenant(tenant.id, tenant.slug);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
    }

    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Test tenant provisioning failed and rollback was incomplete.",
      );
    }

    throw error;
  }
}
