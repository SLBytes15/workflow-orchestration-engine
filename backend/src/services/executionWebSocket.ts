import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  executionTicketService,
  type ExecutionTicketService,
} from "./executionTicket.service";

export const EXECUTION_WS_PATH = "/ws/executions";

/** Client messages are ignored; only a small handshake payload is tolerated. */
const MAX_CLIENT_PAYLOAD_BYTES = 1024;

export type ExecutionEventType =
  | "execution.updated"
  | "execution.completed"
  | "execution.failed";

export interface ExecutionEventData {
  executionId: string;
  workflowId: string;
  status: string;
  updatedAt: string;
}

export interface ExecutionEventEnvelope {
  type: ExecutionEventType;
  data: ExecutionEventData;
}

/**
 * Maps a persisted execution status to the approved event type.
 *
 * `compensated` and `compensation_failed` are real persisted terminal states
 * but their event mapping has not been approved, so they deliberately return
 * `null` instead of being reported as `completed` or `failed`.
 */
export function eventTypeForStatus(status: string): ExecutionEventType | null {
  switch (status) {
    case "queued":
    case "running":
    case "compensating":
      return "execution.updated";
    case "completed":
      return "execution.completed";
    case "failed":
      return "execution.failed";
    default:
      return null;
  }
}

export interface ExecutionEventHub {
  attach(server: Server): WebSocketServer;
  publish(tenantId: string, envelope: ExecutionEventEnvelope): void;
  close(): Promise<void>;
  connectionCount(tenantId: string): number;
  tenantCount(): number;
}

export interface ExecutionEventHubOptions {
  tickets?: ExecutionTicketService;
  path?: string;
}

/**
 * Tenant-scoped WebSocket fan-out for execution lifecycle notifications.
 *
 * Delivery is best effort: a broken socket, a closed socket or a send error
 * never throws into the caller, so workflow execution and persistence can
 * never be rolled back by a notification failure.
 */
export function createExecutionEventHub(
  options: ExecutionEventHubOptions = {},
): ExecutionEventHub {
  const tickets = options.tickets ?? executionTicketService;
  const path = options.path ?? EXECUTION_WS_PATH;
  const socketsByTenant = new Map<string, Set<WebSocket>>();
  let webSocketServer: WebSocketServer | null = null;

  const removeSocket = (tenantId: string, socket: WebSocket): void => {
    const sockets = socketsByTenant.get(tenantId);

    if (!sockets) {
      return;
    }

    sockets.delete(socket);

    if (sockets.size === 0) {
      socketsByTenant.delete(tenantId);
    }
  };

  return {
    attach(server: Server): WebSocketServer {
      if (webSocketServer) {
        return webSocketServer;
      }

      const wss = new WebSocketServer({
        server,
        path,
        maxPayload: MAX_CLIENT_PAYLOAD_BYTES,
      });

      wss.on("connection", (socket, request) => {
        const requestUrl = new URL(
          request.url ?? "/",
          "http://localhost",
        );
        const consumed = tickets.consume(
          requestUrl.searchParams.get("ticket"),
        );

        if (!consumed) {
          socket.close(4401, "Unauthorized");
          return;
        }

        const tenantId = consumed.tenantId;
        const sockets = socketsByTenant.get(tenantId) ?? new Set<WebSocket>();
        sockets.add(socket);
        socketsByTenant.set(tenantId, sockets);

        // Clients do not drive execution updates; unsupported messages are
        // ignored instead of being interpreted.
        socket.on("message", () => undefined);

        socket.on("close", () => {
          removeSocket(tenantId, socket);
        });

        socket.on("error", () => {
          removeSocket(tenantId, socket);
        });
      });

      wss.on("error", () => {
        // Server level errors are logged by the process owner. Socket level
        // failures must not crash the process.
      });

      webSocketServer = wss;
      return wss;
    },

    publish(tenantId: string, envelope: ExecutionEventEnvelope): void {
      const sockets = socketsByTenant.get(tenantId);

      if (!sockets || sockets.size === 0) {
        return;
      }

      let payload: string;

      try {
        payload = JSON.stringify(envelope);
      } catch {
        return;
      }

      for (const socket of [...sockets]) {
        if (socket.readyState !== WebSocket.OPEN) {
          if (socket.readyState === WebSocket.CLOSED) {
            removeSocket(tenantId, socket);
          }
          continue;
        }

        try {
          socket.send(payload, (error) => {
            if (error) {
              removeSocket(tenantId, socket);
            }
          });
        } catch {
          removeSocket(tenantId, socket);
        }
      }
    },

    async close(): Promise<void> {
      const wss = webSocketServer;
      webSocketServer = null;

      for (const socket of [...socketsByTenant.values()].flatMap((sockets) => [
        ...sockets,
      ])) {
        try {
          socket.terminate();
        } catch {
          // Ignore teardown errors; the socket is already unusable.
        }
      }

      socketsByTenant.clear();

      if (!wss) {
        return;
      }

      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    },

    connectionCount(tenantId: string): number {
      return socketsByTenant.get(tenantId)?.size ?? 0;
    },

    tenantCount(): number {
      return socketsByTenant.size;
    },
  };
}

export interface PersistedExecutionLike {
  _id: unknown;
  tenantId: unknown;
  workflowId: unknown;
  status: string;
  updatedAt?: Date | string | null;
}

/**
 * Publishes a notification for an execution that has already been persisted.
 * Never throws: best-effort delivery must not affect workflow execution.
 */
export function publishPersistedExecution(
  hub: ExecutionEventHub,
  execution: PersistedExecutionLike,
): void {
  try {
    const type = eventTypeForStatus(execution.status);

    if (!type) {
      return;
    }

    const tenantId =
      typeof execution.tenantId === "string"
        ? execution.tenantId
        : String(execution.tenantId);
    const updatedAt = execution.updatedAt ?? new Date();

    hub.publish(tenantId, {
      type,
      data: {
        executionId: String(execution._id),
        workflowId: String(execution.workflowId),
        status: execution.status,
        updatedAt:
          updatedAt instanceof Date
            ? updatedAt.toISOString()
            : new Date(updatedAt).toISOString(),
      },
    });
  } catch {
    // Notification failures are non-fatal by design.
  }
}

export const executionEventHub = createExecutionEventHub();
