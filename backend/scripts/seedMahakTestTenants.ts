import "dotenv/config";
import mongoose from "mongoose";
import ApiKeyModel from "../src/models/apiKey.model";
import TenantModel from "../src/models/tenant.model";
import { connectDatabase } from "../src/config/database";
import { createApiKeyManagementService } from "../src/services/apiKeyManagement.service";
import { createTenantResolver } from "../src/services/tenantResolver";
import {
  assertTestTenantSeedDatabase,
  assertTestTenantSeedEnvironment,
  provisionMahakTestTenants,
} from "../src/services/testTenantProvisioning.service";

function formatError(error: unknown): string {
  if (error instanceof AggregateError) {
    return `${error.message} (${error.errors.length} error details suppressed)`;
  }

  return "Provisioning failed; sensitive error details were suppressed.";
}

async function main(): Promise<void> {
  assertTestTenantSeedEnvironment(process.env);

  try {
    await connectDatabase();
    assertTestTenantSeedDatabase(mongoose.connection.name);

    const keyManagement = createApiKeyManagementService();
    const tenantResolver = createTenantResolver();

    const results = await provisionMahakTestTenants({
      async findTenantBySlug(slug) {
        const tenant = await TenantModel.findOne({ slug })
          .select("_id name slug status")
          .lean()
          .exec();

        return tenant
          ? {
              id: tenant._id,
              name: tenant.name,
              slug: tenant.slug,
              status: tenant.status,
            }
          : null;
      },

      async createTenant(input) {
        const tenant = await TenantModel.create({
          ...input,
          status: "active",
        });

        return {
          id: tenant._id,
          name: tenant.name,
          slug: tenant.slug,
          status: tenant.status,
        };
      },

      async hasActiveApiKey(tenantId) {
        const key = await ApiKeyModel.findOne({
          tenantId,
          status: "active",
        })
          .select("_id")
          .lean()
          .exec();

        return key !== null;
      },

      async createApiKey(tenantId) {
        return keyManagement.createKey({ tenantId });
      },

      resolveApiKey(apiKey) {
        return tenantResolver.resolverTenant(apiKey);
      },

      async deleteCreatedApiKey(keyId, tenantId) {
        const deletion = await ApiKeyModel.deleteOne({
          _id: keyId,
          tenantId,
        }).exec();

        if (deletion.deletedCount !== 1) {
          throw new Error(
            `Could not remove newly created API key record ${keyId} during rollback.`,
          );
        }
      },

      async deleteCreatedTenant(tenantId, slug) {
        const deletion = await TenantModel.deleteOne({
          _id: tenantId,
          slug,
          status: "active",
        }).exec();

        if (deletion.deletedCount !== 1) {
          throw new Error(
            `Could not remove newly created tenant "${slug}" during rollback.`,
          );
        }
      },
    });

    console.log("Test tenant provisioning complete.");
    console.log(
      JSON.stringify(
        results.map(({ tenant, apiKey, keyAlreadyExisted }) => ({
          tenantId: tenant.id.toString(),
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
          ...(apiKey
            ? {
                apiKeyId: apiKey.id,
                apiKeyPrefix: apiKey.keyPrefix,
                apiKey: apiKey.plaintextKey,
              }
            : {
                apiKey: null,
                note: keyAlreadyExisted
                  ? "An active key already exists; it was not rotated or displayed."
                  : "No API key was created.",
              }),
        })),
        null,
        2,
      ),
    );
    console.log(
      "Securely share newly displayed API keys through the team's approved secret-sharing mechanism. They cannot be retrieved by rerunning this command.",
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("[SEED TEST TENANTS] Failed:", formatError(error));
  process.exitCode = 1;
});
