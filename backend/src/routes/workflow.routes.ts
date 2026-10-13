import { Router } from "express";
import { tenantAuthMiddleware } from "../middleware/tenantAuth.middleware";
import { validateRequest } from "../middleware/validateRequest.middleware";
import { createTenantResolver } from "../services/tenantResolver";
import { validateCreateWorkflow } from "../validators/workflow.validator";
import { createWorkflowService } from "../services/workflow.service";

const workflowService = createWorkflowService();

const router = Router();

const requireTenantAuth = tenantAuthMiddleware(createTenantResolver());

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

      const workflow = await workflowService.createWorkflow({
        tenantId: tenantContext.tenantId,
        input: res.locals.validatedBody as {
          name: string;
          description?: string;
        },
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

export default router;
