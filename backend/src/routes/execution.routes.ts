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

    
      const input = req.body?.input;

      if (
        input !== undefined &&
        (input === null || typeof input !== "object" || Array.isArray(input))
      ) {
        res.status(400).json({
          error: {
            code: "INVALID_EXECUTION_INPUT",
            message: "Execution input must be a JSON object.",
          },
        });
        return;
      }


const execution = await service.startExecution(
  tenant.tenantId,
  String(req.params.workflowId),
  input ?? {},
);


     res.status(200).json({
       message:
         execution.status === "completed"
           ? "Workflow execution completed"
           : "Workflow execution failed",
       execution: {
         id: String(execution._id),
         workflowId: String(execution.workflowId),
         workflowVersion: execution.workflowVersion,
         status: execution.status,
         currentNodeId: execution.currentNodeId ?? null,
         nodeResults: execution.nodeResults ?? [],
         error: execution.error ?? null,
         startedAt: execution.startedAt ?? null,
         completedAt: execution.completedAt ?? null,
         createdAt: execution.createdAt,
       },
     });
    } catch (error) {
      next(error);
    }
  });

  router.get("/", requireTenantAuth, async (req, res, next) => {
    try {
      if (req.baseUrl.endsWith("/workflows")) {
        next();
        return;
      }

      const tenant = req.tenantContext;
      if (!tenant) {
        res.status(401).json({ error: { code: "UNAUTHORIZED", message: "A valid API key is required" } });
        return;
      }

      const result = await service.listGlobalExecutions(tenant.tenantId, {
        workflowId: req.query.workflowId,
        status: req.query.status,
        from: req.query.from,
        to: req.query.to,
        executionId: req.query.executionId,
        limit: req.query.limit,
        cursor: req.query.cursor,
      });

      res.status(200).json({ message: "Execution history retrieved successfully", ...result });
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

  router.get("/summary", requireTenantAuth, async (req, res, next) => {
    try {
      if (req.baseUrl.endsWith("/workflows")) {
        next();
        return;
      }

      const tenant = req.tenantContext;
      if (!tenant) {
        res.status(401).json({ error: { code: "UNAUTHORIZED", message: "A valid API key is required" } });
        return;
      }

      const result = await service.getExecutionSummary(tenant.tenantId, {
        workflowId: req.query.workflowId,
        from: req.query.from,
        to: req.query.to,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/:executionId", requireTenantAuth, async (req, res, next) => {
    try {
      if (req.baseUrl.endsWith("/workflows")) {
        next();
        return;
      }

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
