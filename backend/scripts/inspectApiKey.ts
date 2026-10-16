declare const process: {
  exitCode?: number;
};

import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "../src/config/database";
import ApiKeyModel from "../src/models/apiKey.model";
import TenantModel from "../src/models/tenant.model";

async function main(): Promise<void> {
  try {
    await connectDatabase();

    const keyId = "6ace325658bd65d0d9f57afb";

    const tenant = await TenantModel.findOne({ slug: "local-dev" })
      .select("_id name slug status")
      .lean()
      .exec();

    console.log("Database:", mongoose.connection.name);
    console.log("Tenant:", tenant);

    const key = await ApiKeyModel.findById(keyId)
      .select("tenantId keyPrefix status expiresAt revokedAt")
      .lean()
      .exec();

    console.log("API key record:", key);
    console.log(
      "Tenant IDs match:",
      Boolean(tenant && key && String(tenant._id) === String(key.tenantId)),
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    "[INSPECT] Failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
