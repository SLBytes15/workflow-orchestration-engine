import { Router } from "express";
import { tenantAuthMiddleware } from "../middleware/tenantAuth.middleware";
import { validateRequest } from "../middleware/validateRequest.middleware";
import {
  createTenantResolver,
  type TenantResolver,
} from "../services/tenantResolver";
import { createWorkflowService } from "../services/workflow.service";
import {
  validateCreateWorkflow,
  type CreateWorkflowInput,
} from "../validators/workflow.validator";
import {
  validateConditionConfigurations,
  validateWorkflowGraph,
  type WorkflowGraph,
} from "../validators/workflow-graph.validator";


export function createWorkflowRouter(
  resolver: TenantResolver = createTenantResolver(),
  service = createWorkflowService(),
) {
  const router = Router();
  const requireTenantAuth = tenantAuthMiddleware(resolver);

  router.delete("/:workflowId", requireTenantAuth, async (req, res, next) => {
    try {
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

      const workflowId = String(req.params.workflowId);
      if (!/^[a-f\d]{24}$/i.test(workflowId)) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "workflowId must be a valid ID",
          },
        });
        return;
      }

      const workflow = await service.deleteWorkflow(
        tenantContext.tenantId,
        workflowId,
      );
      if (!workflow) {
        res.status(404).json({
          error: {
            code: "WORKFLOW_NOT_FOUND",
            message: "Workflow not found",
          },
        });
        return;
      }

      res.status(200).json({
        message: "Workflow deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/", requireTenantAuth, async (req, res, next) => {
    try {
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

      const workflows = await service.listWorkflows(tenantContext.tenantId);

      res.status(200).json({
        message: "Workflows retrieved successfully",
        workflows,
      });
    } catch (error) {
      next(error);
    }
  });

  router.put("/:workflowId/graph", requireTenantAuth, async (req, res, next) => {
    try {
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

      const workflowId = String(req.params.workflowId);
      if (!/^[a-f\d]{24}$/i.test(workflowId)) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "workflowId must be a valid ID",
          },
        });
        return;
      }

      const body = req.body;
      const graphErrors =
        typeof body !== "object" ||
        body === null ||
        Array.isArray(body) ||
        Object.keys(body).some((key) => key !== "graph")
          ? ["Request body must contain only graph"]
          : validateWorkflowGraph(body.graph);
      const errors = [
        ...graphErrors,
        ...(graphErrors.length === 0
          ? validateConditionConfigurations(body.graph)
          : []),
      ];

      if (errors.length > 0) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "The workflow graph is invalid",
            details: errors,
          },
        });
        return;
      }

      const workflow = await service.updateWorkflowGraph(
        tenantContext.tenantId,
        workflowId,
        body.graph as WorkflowGraph,
      );

      if (!workflow) {
        res.status(404).json({
          error: {
            code: "WORKFLOW_NOT_FOUND",
            message: "Workflow not found",
          },
        });
        return;
      }

      res.status(200).json({
        message: "Workflow graph updated successfully",
        workflow,
      });
    } catch (error) {
      next(error);
    }
  });


  router.post(
    "/",
    requireTenantAuth,
    validateRequest(validateCreateWorkflow),
    async (req, res, next) => {
      try {
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

        const workflow = await service.createWorkflow({
          tenantId: tenantContext.tenantId,

          input: res.locals.validatedBody as CreateWorkflowInput,
        });

        res.status(201).json({
          message: "Workflow created successfully",
          workflow,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export default createWorkflowRouter();
