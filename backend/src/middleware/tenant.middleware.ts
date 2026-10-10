import type { NextFunction, Request, Response } from "express";
import { resolveApiKey } from "../services/apiKeyResolver";

export interface TenantContext {
  tenantId: string;
  tenantKey: string;
}

export interface TenantRequest extends Request {
  tenant: TenantContext;
}

export function tenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const apiKey = req.header("x-api-key");

  if (!apiKey) {
    res.status(401).json({ error: "Missing API key" });
    return;
  }

  const tenant = resolveApiKey(apiKey);

  if (!tenant) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  (req as TenantRequest).tenant = tenant;
  next();
}
