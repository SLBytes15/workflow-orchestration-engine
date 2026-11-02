import { Router } from "express";
import { Types } from "mongoose";
import { tenantAuthMiddleware } from "../middleware/tenantAuth.middleware";
import { createTenantResolver, type TenantResolver } from "../services/tenantResolver";
import {
  createExecutionService,
  ExecutionServiceError,
} from "../services/execution.service";
import {
  computePayloadHash,
  defaultIdempotencyService,
  type IdempotencyService,
} from "../services/executionIdempotency";

export function createExecutionRouter(
  resolver: TenantResolver = createTenantResolver(),
  service = createExecutionService(),
  idempotencyService: IdempotencyService = defaultIdempotencyService,
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


      const idempotencyKey = req.header("Idempotency-Key")?.trim();
      let payloadHash: string | undefined;
      let allocatedExecutionId: Types.ObjectId | undefined;
      let check: any;

      if (idempotencyKey) {
        payloadHash = computePayloadHash(input ?? {});
        allocatedExecutionId = new Types.ObjectId();
        check = await idempotencyService.reserveKey(
          tenant.tenantId,
          String(req.params.workflowId),
          idempotencyKey,
          payloadHash,
          { executionId: allocatedExecutionId },
        );

        if (check.status === "mismatch") {
          res.status(409).json({
            error: {
              code: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH",
              message:
                "The Idempotency-Key has already been used with a different request payload.",
            },
          });
          return;
        }

        if (check.status === "match") {
          res.status(200).json(check.responseBody);
          return;
        }

        if (check.status === "in_flight") {
          res.status(409).json({
            error: {
              code: "IDEMPOTENCY_KEY_IN_FLIGHT",
              message:
                "An execution with this Idempotency-Key is currently in progress.",
            },
            executionId: check.executionId,
          });
          return;
        }
      }

      let execution;
      try {
        if (idempotencyKey && check?.reservationToken) {
          const isOwner = await idempotencyService.validateOwnership(
            tenant.tenantId,
            String(req.params.workflowId),
            idempotencyKey,
            check.reservationToken,
          );
          if (!isOwner) {
            res.status(409).json({
              error: {
                code: "IDEMPOTENCY_RESERVATION_LOST",
                message: "The reservation for this Idempotency-Key was superseded or expired.",
              },
            });
            return;
          }
        }

        const executionIdToUse = check?.executionId
          ? new Types.ObjectId(check.executionId)
          : allocatedExecutionId;

        execution = await service.startExecution(
          tenant.tenantId,
          String(req.params.workflowId),
          input ?? {},
          executionIdToUse ? { executionId: executionIdToUse } : undefined,
        );
      } catch (err) {
        if (idempotencyKey) {
          await idempotencyService.clearKey(
            tenant.tenantId,
            String(req.params.workflowId),
            idempotencyKey,
            check?.reservationToken,
          );
        }
        throw err;
      }

      const responseBody = {
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
      };

      if (idempotencyKey && payloadHash) {
        await idempotencyService.recordCompleted(
          tenant.tenantId,
          String(req.params.workflowId),
          idempotencyKey,
          payloadHash,
          execution._id,
          responseBody,
          check?.reservationToken ? { reservationToken: check.reservationToken } : undefined,
        );
      }

      res.status(200).json(responseBody);
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
