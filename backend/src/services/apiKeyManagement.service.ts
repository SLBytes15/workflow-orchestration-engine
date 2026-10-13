import { Types } from "mongoose";
import ApiKeyModel from "../models/apiKey.model";
import TenantModel from "../models/tenant.model";
import { generateApiKey } from "./apiKeyCrypto";

export interface CreateApiKeyInput {
  tenantId: Types.ObjectId;
  expiresAt?: Date | null;
}

export interface CreatedApiKey {
  id: string;
  tenantId: Types.ObjectId;
  keyPrefix: string;
  plaintextKey: string;
  expiresAt: Date | null;
}

export interface ApiKeyManagementDependencies {
  findActiveTenant(tenantId: Types.ObjectId): Promise<boolean>;

  createKeyRecord(record: {
    tenantId: Types.ObjectId;
    keyHash: string;
    keyPrefix: string;
    status: "active";
    expiresAt: Date | null;
    revokedAt: null;
  }): Promise<{ id: string }>;

  revokeKeyRecord(
    keyId: string,
    tenantId: Types.ObjectId,
    revokedAt: Date,
  ): Promise<boolean>;
}

const databaseDependencies: ApiKeyManagementDependencies = {
  async findActiveTenant(tenantId) {
    const tenant = await TenantModel.findOne({
      _id: tenantId,
      status: "active",
    })
      .select("_id")
      .lean()
      .exec();

    return tenant !== null;
  },

  async createKeyRecord(record) {
    const created = await ApiKeyModel.create(record);
    return { id: created._id.toString() };
  },

  async revokeKeyRecord(keyId, tenantId, revokedAt) {
    const updated = await ApiKeyModel.findOneAndUpdate(
      {
        _id: keyId,
        tenantId,
        status: "active",
        revokedAt: null,
      },
      {
        $set: {
          status: "revoked",
          revokedAt,
        },
      },
      { returnDocument: "after" },
    )
      .select("_id")
      .lean()
      .exec();

    return updated !== null;
  },
};

export function createApiKeyManagementService(
  dependencies: ApiKeyManagementDependencies = databaseDependencies,
) {
  return {
    async createKey(input: CreateApiKeyInput): Promise<CreatedApiKey> {
      if (
        input.expiresAt !== undefined &&
        input.expiresAt !== null &&
        (!(input.expiresAt instanceof Date) ||
          !Number.isFinite(input.expiresAt.getTime()) ||
          input.expiresAt.getTime() <= Date.now())
      ) {
        throw new Error("Expiry must be a valid future date");
      }

      const tenantIsActive = await dependencies.findActiveTenant(
        input.tenantId,
      );

      if (!tenantIsActive) {
        throw new Error("Active tenant not found");
      }

      const generated = generateApiKey();
      const expiresAt = input.expiresAt ?? null;

      const record = await dependencies.createKeyRecord({
        tenantId: input.tenantId,
        keyHash: generated.keyHash,
        keyPrefix: generated.keyPrefix,
        status: "active",
        expiresAt,
        revokedAt: null,
      });

      return {
        id: record.id,
        tenantId: input.tenantId,
        keyPrefix: generated.keyPrefix,
        plaintextKey: generated.plaintextKey,
        expiresAt,
      };
    },

    async revokeKey(keyId: string, tenantId: Types.ObjectId): Promise<boolean> {
      if (!Types.ObjectId.isValid(keyId)) {
        return false;
      }

      return dependencies.revokeKeyRecord(keyId, tenantId, new Date());
    },
  };
}
