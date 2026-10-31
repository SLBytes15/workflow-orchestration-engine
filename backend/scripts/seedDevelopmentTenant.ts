import "dotenv/config";
import mongoose from "mongoose";
import TenantModel from "../src/models/tenant.model";

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  try {
    await mongoose.connect(process.env.MONGODB_URI!);

    if (mongoose.connection.name !== "test") {
      throw new Error(
        `Refusing to seed unexpected database: ${mongoose.connection.name}`,
      );
    }

    const slug = process.env.TENANT_SLUG?.trim() || "local-dev";
    const name =
      process.env.TENANT_NAME?.trim() ||
      (slug === "local-dev" ? "Local Development Tenant" : slug);

    const tenant = await TenantModel.findOneAndUpdate(
      { slug },
      {
        $setOnInsert: {
          name,
          slug,
          status: "active",
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
      },
    ).exec();

    console.log("Development tenant ready:");
    console.log({
      name: tenant?.name,
      slug: tenant?.slug,
      status: tenant?.status,
      id: tenant?._id.toString(),
    });
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    "[SEED TENANT] Failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
