declare const process: {
  exitCode?: number;
};

import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "../src/config/database";
import TenantModel from "../src/models/tenant.model";
import { createApiKeyManagementService } from "../src/services/apiKeyManagement.service";

async function main(): Promise<void> {
  try {
    await connectDatabase();

    const tenant = await TenantModel.findOne({ slug: "local-dev" })
      .select("_id")
      .lean()
      .exec();

    if (!tenant) {
      throw new Error("Development tenant not found");
    }

    const service = createApiKeyManagementService();
    const revoked = await service.revokeKey(
      "6ace2ff3160e7c1340b6a7b1",
      tenant._id,
    );

    if (!revoked) {
      throw new Error("Key was not revoked; verify its ID and tenant");
    }

    console.log("Exposed API key revoked successfully.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    "[REVOKE] Failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
