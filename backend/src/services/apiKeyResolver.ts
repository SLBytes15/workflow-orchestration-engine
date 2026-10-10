export interface ResolvedTenant {
  tenantId: string;
  tenantKey: string;
}

interface ApiKeyRecord extends ResolvedTenant {
  apiKey: string;
}

// Development-only examples. Never use these as real credentials.
const developmentApiKeys: ApiKeyRecord[] = [
  {
    apiKey: "dev-example-key-001",
    tenantId: "tenant-001",
    tenantKey: "example-tenant",
  },
];

export function resolveApiKey(apiKey: string): ResolvedTenant | null {
  const record = developmentApiKeys.find((entry) => entry.apiKey === apiKey);

  if (!record) {
    return null;
  }

  return {
    tenantId: record.tenantId,
    tenantKey: record.tenantKey,
  };
}
