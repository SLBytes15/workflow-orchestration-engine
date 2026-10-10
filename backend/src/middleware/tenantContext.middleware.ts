import type { NextFunction, Request, Response } from "express";

const TENANT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export interface TenantContextRequest extends Request {
  tenantId: string;
}

export function tenantContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const tenantId = req.header("x-tenant-id")?.trim();

  if (!tenantId) {
    res.status(400).json({
      error: "Missing x-tenant-id header",
    });
    return;
  }

  if (!TENANT_ID_PATTERN.test(tenantId)) {
    res.status(400).json({
      error: "Invalid tenant ID format",
    });
    return;
  }

  (req as TenantContextRequest).tenantId = tenantId;
  next();
}
