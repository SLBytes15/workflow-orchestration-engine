import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "../src/config/database";
import TenantModel from "../src/models/tenant.model";
import { createApiKeyManagementService } from "../src/services/apiKeyManagement.service";

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  try {
    await connectDatabase();

    const tenantSlug = process.env.TENANT_SLUG?.trim();

    // First run: list active tenants so you can choose the correct one.
    if (!tenantSlug) {
      const tenants = await TenantModel.find({ status: "active" })
        .select("name slug")
        .lean()
        .exec();

      if (tenants.length === 0) {
        console.log(
          "No active tenants found. Create an approved development tenant first.",
        );
        return;
      }

      console.log("Active tenants (no API keys created):");
      for (const tenant of tenants) {
        console.log(`Name: ${tenant.name} | Slug: ${tenant.slug}`);
      }

      console.log(
        "\nRerun with TENANT_SLUG set to the intended tenant's slug.",
      );
      return;
    }

    const tenant = await TenantModel.findOne({
      slug: tenantSlug,
      status: "active",
    })
      .select("_id")
      .lean()
      .exec();

    if (!tenant) {
      throw new Error("The specified active tenant was not found.");
    }

    const service = createApiKeyManagementService();

    const created = await service.createKey({
      tenantId: tenant._id,
    });

    console.log("\nAPI KEY CREATED");
    console.log("Tenant slug:", tenantSlug);
    console.log("Key ID:", created.id);
    console.log("Key prefix:", created.keyPrefix);
    console.log("\nYour API key (shown once):");
    console.log(created.plaintextKey);
    console.log(
      "\nCopy it to a secure location. Do not commit it or share it.",
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    "[SEED] Failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
