import type { Types } from "mongoose";
import ApiKeyModel from "../models/apiKey.model";
import TenantModel from "../models/tenant.model";
import { hashApiKey } from "./apiKeyCrypto";

export interface TenantResolution {
  tenantId: Types.ObjectId;
}

export interface TenantResolver {
  resolverTenant(apiKey: string): Promise<TenantResolution | null>;
}

interface ApiKeyRecord {
  tenantId: Types.ObjectId;
  status: "active" | "revoked";
  expiresAt: Date | null;
  revokedAt: Date | null;
}

interface TenantRecord {
  _id: Types.ObjectId;
  status: "active" | "inactive";
}

export interface TenantResolverDependencies {
  findApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null>;

  findTenantById(tenantId: Types.ObjectId): Promise<TenantRecord | null>;
}

const databaseDependencies: TenantResolverDependencies = {
  async findApiKeyByHash(keyHash) {
    return ApiKeyModel.findOne({ keyHash })
      .select("+keyHash")
      .lean<ApiKeyRecord>()
      .exec();
  },

  async findTenantById(tenantId) {
    return TenantModel.findById(tenantId)
      .select("status")
      .lean<TenantRecord>()
      .exec();
  },
};

export function createTenantResolver(
  dependencies: TenantResolverDependencies = databaseDependencies,
): TenantResolver {
  return {
    async resolverTenant(apiKey) {
      if (!apiKey.trim()) {
        return null;
      }

      const keyHash = hashApiKey(apiKey);
      const keyRecord = await dependencies.findApiKeyByHash(keyHash);

      if (!keyRecord || keyRecord.status !== "active") {
        return null;
      }

      if (keyRecord.revokedAt !== null) {
        return null;
      }

      if (
        keyRecord.expiresAt !== null &&
        keyRecord.expiresAt.getTime() <= Date.now()
      ) {
        return null;
      }

      const tenant = await dependencies.findTenantById(keyRecord.tenantId);

      if (!tenant || tenant.status !== "active") {
        return null;
      }

      return { tenantId: tenant._id };
    },
  };
}
