import { Router } from "express";
import { Types } from "mongoose";
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
  validateUpdateWorkflow,
  type UpdateWorkflowInput,
} from "../validators/workflow.validator";


export function createWorkflowRouter(
  resolver: TenantResolver = createTenantResolver(),
  service = createWorkflowService(),
) {
  const router = Router();
  const requireTenantAuth = tenantAuthMiddleware(resolver);


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

  router.patch(
    "/:workflowId",
    requireTenantAuth,
    validateRequest(validateUpdateWorkflow),
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

        const workflowId = req.params.workflowId;

        if (typeof workflowId !== "string" || !Types.ObjectId.isValid(workflowId)) {
          res.status(400).json({
            error: {
              code: "INVALID_WORKFLOW_ID",
              message: "A valid workflow ID is required",
            },
          });
          return;
        }

        const workflow = await service.updateWorkflow({
          tenantId: tenantContext.tenantId,
          workflowId: new Types.ObjectId(workflowId),
          input: res.locals.validatedBody as UpdateWorkflowInput,
        });

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
          message: "Workflow updated successfully",
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
