import { Router } from "express";
import { tenantAuthMiddleware } from "../middleware/tenantAuth.middleware";
import {
  createTenantResolver,
  type TenantResolver,
} from "../services/tenantResolver";
import {
  executionTicketService,
  type ExecutionTicketService,
} from "../services/executionTicket.service";

/**
 * Issues the short-lived, single-use ticket a browser uses to open
 * `/ws/executions`. The tenant always comes from the existing API-key
 * authentication middleware, never from the request body or query string.
 */
export function createExecutionWsTicketRouter(
  resolver: TenantResolver = createTenantResolver(),
  tickets: ExecutionTicketService = executionTicketService,
) {
  const router = Router();
  const requireTenantAuth = tenantAuthMiddleware(resolver);

  router.post("/ws-ticket", requireTenantAuth, (req, res) => {
    const tenant = req.tenantContext;

    if (!tenant) {
      res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "A valid API key is required",
        },
      });
      return;
    }

    const issued = tickets.issue(tenant.tenantId.toString());

    res.status(200).json({
      ticket: issued.ticket,
      expiresAt: issued.expiresAt,
    });
  });

  return router;
}

export default createExecutionWsTicketRouter();
