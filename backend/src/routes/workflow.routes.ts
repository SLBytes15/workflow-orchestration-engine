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
import {
  validateConditionConfigurations,
  validateWorkflowGraph,
  type WorkflowGraph,
} from "../validators/workflow-graph.validator";
import { validateTriggerConfigurations } from "../validators/event-contract.validator";


export type WorkflowRouterService =
  | ReturnType<typeof createWorkflowService>
  | {
      createWorkflow: (command: any) => Promise<unknown>;
      listWorkflows: (tenantId: Types.ObjectId) => Promise<unknown[]>;
      getWorkflowById?: (
        tenantId: Types.ObjectId,
        workflowId: string,
      ) => Promise<unknown | null>;
      updateWorkflow: (command: any) => Promise<unknown | null>;
      updateWorkflowGraph: (
        tenantId: Types.ObjectId,
        workflowId: string,
        graph: any,
      ) => Promise<unknown | null>;
      deleteWorkflow: (
        tenantId: Types.ObjectId,
        workflowId: string,
      ) => Promise<unknown | null>;
      activateWorkflow: (
        tenantId: Types.ObjectId,
        workflowId: string,
      ) => Promise<any>;
      pauseWorkflow: (
        tenantId: Types.ObjectId,
        workflowId: string,
      ) => Promise<any>;
      resumeWorkflow: (
        tenantId: Types.ObjectId,
        workflowId: string,
      ) => Promise<any>;
    };

export function createWorkflowRouter(
  resolver: TenantResolver = createTenantResolver(),
  service: WorkflowRouterService = createWorkflowService(),
) {
  const router = Router();
  const requireTenantAuth = tenantAuthMiddleware(resolver);

  router.post("/:workflowId/activate", requireTenantAuth, async (req, res, next) => {
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

      const result = await service.activateWorkflow(
        tenantContext.tenantId,
        workflowId,
      );

      if (result.outcome === "not_found") {
        res.status(404).json({
          error: {
            code: "WORKFLOW_NOT_FOUND",
            message: "Workflow not found",
          },
        });
        return;
      }

      if (result.outcome === "invalid_status") {
        res.status(400).json({
          error: {
            code: "INVALID_WORKFLOW_STATUS",
            message: "Only draft workflows can be activated",
          },
        });
        return;
      }

      if (result.outcome === "invalid_graph") {
        res.status(400).json({
          error: {
            code: "INVALID_WORKFLOW_GRAPH",
            message: "The workflow graph is invalid and cannot be activated",
            details: result.errors,
          },
        });
        return;
      }

      res.status(200).json({
        message: "Workflow activated successfully",
        workflow: result.workflow,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:workflowId/pause", requireTenantAuth, async (req, res, next) => {
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

      const result = await service.pauseWorkflow(
        tenantContext.tenantId,
        workflowId,
      );

      if (result.outcome === "not_found") {
        res.status(404).json({
          error: {
            code: "WORKFLOW_NOT_FOUND",
            message: "Workflow not found",
          },
        });
        return;
      }

      if (result.outcome === "invalid_status") {
        res.status(400).json({
          error: {
            code: "INVALID_WORKFLOW_STATUS",
            message: "Only active workflows can be paused",
          },
        });
        return;
      }

      res.status(200).json({
        message: "Workflow paused successfully",
        workflow: result.workflow,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/:workflowId/resume", requireTenantAuth, async (req, res, next) => {
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

      const result = await service.resumeWorkflow(
        tenantContext.tenantId,
        workflowId,
      );

      if (result.outcome === "not_found") {
        res.status(404).json({
          error: {
            code: "WORKFLOW_NOT_FOUND",
            message: "Workflow not found",
          },
        });
        return;
      }

      if (result.outcome === "invalid_status") {
        res.status(400).json({
          error: {
            code: "INVALID_WORKFLOW_STATUS",
            message: "Only paused workflows can be resumed",
          },
        });
        return;
      }

      if (result.outcome === "invalid_graph") {
        res.status(400).json({
          error: {
            code: "INVALID_WORKFLOW_GRAPH",
            message: "The workflow graph is invalid and cannot be resumed",
            details: result.errors,
          },
        });
        return;
      }

      res.status(200).json({
        message: "Workflow resumed successfully",
        workflow: result.workflow,
      });
    } catch (error) {
      next(error);
    }
  });

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

  router.get("/:workflowId", requireTenantAuth, async (req, res, next) => {
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

      if (!service.getWorkflowById) {
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Workflow lookup not supported",
          },
        });
        return;
      }

      const workflow = await service.getWorkflowById(
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
        message: "Workflow retrieved successfully",
        workflow,
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
          ? [
              ...validateConditionConfigurations(body.graph),
              ...validateTriggerConfigurations(body.graph),
            ]
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
