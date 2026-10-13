import { Types } from "mongoose"

export interface TrustedTenantContext {
    tenantId: Types.ObjectId;
}

export interface AuthenticatedTenantRequest {
    tenantContext: TrustedTenantContext
}