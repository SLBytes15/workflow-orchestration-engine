import { Router } from "express";
import { tenantAuthMiddleware } from "../middleware/tenantAuth.middleware";
import { createTenantResolver, type TenantResolver } from "../services/tenantResolver";
import {
  createExecutionService,
  ExecutionServiceError,
} from "../services/execution.service";

export function createExecutionRouter(
  resolver: TenantResolver = createTenantResolver(),
  service = createExecutionService(),
) {
  const router = Router();
  const requireTenantAuth = tenantAuthMiddleware(resolver);

  router.post("/:workflowId/executions", requireTenantAuth, async (req, res, next) => {
    try {
      const tenant = req.tenantContext;
      if (!tenant) {
        res.status(401).json({ error: { code: "UNAUTHORIZED", message: "A valid API key is required" } });
        return;
      }

      const execution = await service.startExecution(tenant.tenantId, String(req.params.workflowId));
      res.status(202).json({
        message: "Workflow execution queued",
        execution: {
          id: String(execution._id),
          workflowId: String(execution.workflowId),
          workflowVersion: execution.workflowVersion,
          status: execution.status,
          startedAt: execution.startedAt ?? null,
          createdAt: execution.createdAt,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:workflowId/executions", requireTenantAuth, async (req, res, next) => {
    try {
      const tenant = req.tenantContext;
      if (!tenant) {
        res.status(401).json({ error: { code: "UNAUTHORIZED", message: "A valid API key is required" } });
        return;
      }

      const result = await service.listExecutions(
        tenant.tenantId,
        String(req.params.workflowId),
        req.query.limit,
        req.query.cursor,
      );
      res.status(200).json({ message: "Execution history retrieved successfully", ...result });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:executionId", requireTenantAuth, async (req, res, next) => {
    try {
      const tenant = req.tenantContext;
      if (!tenant) {
        res.status(401).json({ error: { code: "UNAUTHORIZED", message: "A valid API key is required" } });
        return;
      }

      const execution = await service.getExecution(tenant.tenantId, String(req.params.executionId));
      res.status(200).json({ message: "Execution retrieved successfully", execution });
    } catch (error) {
      next(error);
    }
  });

  router.use((error: unknown, _req: unknown, res: any, next: (error?: unknown) => void) => {
    if (error instanceof ExecutionServiceError) {
      res.status(error.statusCode).json({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    next(error);
  });

  return router;
}

export default createExecutionRouter();
