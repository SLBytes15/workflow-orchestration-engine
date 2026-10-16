import express from "express";
import cors from "cors";
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
import { createTenantResolver } from "./services/tenantResolver";
import { tenantAuthMiddleware } from "./middleware/tenantAuth.middleware";
import workflowRoutes from "./routes/workflow.routes";

const app = express();
const tenantResolver = createTenantResolver();
const requireTenantAuth = tenantAuthMiddleware(tenantResolver);

app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key"],
  }),
);

app.use(express.json());

app.use((req, _res, next) => {
  console.log("[REQUEST]", req.method, req.path);
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

app.get("/api/test-authenticated-tenant", requireTenantAuth, (req, res) => {
  const tenantContext = req.tenantContext;

  if (!tenantContext) {
    res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "A valid API key is required",
      },
    });
    return;
  }

  res.status(200).json({
    message: "Tenant authenticated successfully",
    tenantId: tenantContext.tenantId.toString(),
  });
});

app.use("/api/workflows", workflowRoutes);

app.use(errorHandler);

export default app;
