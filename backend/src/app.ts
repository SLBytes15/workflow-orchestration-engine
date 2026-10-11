import express from "express";
import { apiRateLimiter } from "./middleware/rateLimit.middleware";
import { errorHandler } from "./middleware/errorHandler.middleware";
import {
  tenantMiddleware,
  type TenantRequest,
} from "./middleware/tenant.middleware";
import {
  tenantContextMiddleware,
  type TenantContextRequest,
} from "./middleware/tenantContext.middleware";

const app = express();

app.use(express.json());

app.use((req, res, next) => {
  console.log("[REQUEST]", req.method, req.url);
  next();
});

app.use("/api", apiRateLimiter);

app.get("/", (_req, res) => {
  res.status(200).send("Express is working!");
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/api/test-tenant-context", tenantContextMiddleware, (req, res) => {
  const tenantReq = req as TenantContextRequest;

  res.status(200).json({
    message: "Tenant context resolved",
    tenantId: tenantReq.tenantId,
  });
});

app.get("/api/test-tenant", tenantMiddleware, (req, res) => {
  const tenantReq = req as TenantRequest;

  res.json({
    message: "Tenant resolved successfully",
    tenantId: tenantReq.tenant.tenantId,
    tenantKey: tenantReq.tenant.tenantKey,
  });
});

app.use(errorHandler);

export default app;
