import type { RequestHandler } from "express";
import type { TenantResolver } from "../services/tenantResolver";

export function tenantAuthMiddleware(resolver: TenantResolver): RequestHandler {
  return async (req, res, next) => {
    const apiKey = req.header("x-api-key")?.trim();

    if (!apiKey) {
      res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "A valid API key is required",
        },
      });
      return;
    }

    try {
      const tenant = await resolver.resolverTenant(apiKey);

      if (!tenant) {
        res.status(401).json({
          error: {
            code: "UNAUTHORIZED",
            message: "A valid API key is required",
          },
        });
        return;
      }

      req.tenantContext = {
        tenantId: tenant.tenantId,
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}
