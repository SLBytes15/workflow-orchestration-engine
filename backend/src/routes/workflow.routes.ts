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


export function createWorkflowRouter(
  resolver: TenantResolver = createTenantResolver(),
  service = createWorkflowService(),
) {
  const router = Router();
  const requireTenantAuth = tenantAuthMiddleware(resolver);

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
