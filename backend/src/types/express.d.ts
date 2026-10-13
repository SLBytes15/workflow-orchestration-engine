import type { TrustedTenantContext } from "./tenantContext";

declare global {
  namespace Express {
    interface Request {
      tenantContext?: TrustedTenantContext;
    }
  }
}

export {};
