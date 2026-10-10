import express from "express";
import { apiRateLimiter } from "./middleware/rateLimit.middleware";
import {
  tenantMiddleware,
  type TenantRequest,
} from "./middleware/tenant.middleware";
import {
  tenantContextMiddleware,
  type TenantContextRequest,
} from "./middleware/tenantContext.middleware";

const app = express();
const PORT = 3000;

console.log("[STARTUP] index.ts is executing");

app.use((req, res, next) => {
  console.log("[REQUEST]", req.method, req.url);
  next();
});
app.use("/api", apiRateLimiter);


app.get("/", (req, res) => {
  res.status(200).send("Express is working!");
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/api/test-tenant-context",tenantContextMiddleware, (req,res)=>{
  const tenantReq = req as TenantContextRequest;

  res.status(200).json({
    message: "Tenant context resolved",
    tenantId: tenantReq.tenantId,
  });
},
);

app.get("/api/test-tenant", tenantMiddleware, (req, res) => {
  const tenantReq = req as TenantRequest;

  res.json({
    message: "Tenant resolved successfully",
    tenantId: tenantReq.tenant.tenantId,
    tenantKey: tenantReq.tenant.tenantKey,
  });
});


const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`[STARTUP] Server listening at http://127.0.0.1:${PORT}`);
});

server.on("error", (error) => {
  console.error("[SERVER ERROR]", error);
});
