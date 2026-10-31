import { randomBytes } from "node:crypto";

export const EXECUTION_TICKET_TTL_MS = 60_000;

export interface IssuedExecutionTicket {
  ticket: string;
  expiresAt: string;
}

interface StoredExecutionTicket {
  tenantId: string;
  expiresAtMs: number;
}

export interface ExecutionTicketServiceOptions {
  now?: () => number;
  ttlMs?: number;
}

/**
 * In-memory, single-process WebSocket ticket store.
 *
 * Tickets are short lived, single use and bound to the tenant that was
 * established by the REST authentication middleware. They never carry an API
 * key and are never logged. Because the store lives in process memory it does
 * not survive a restart and is not shared between backend instances.
 */
export function createExecutionTicketService(
  options: ExecutionTicketServiceOptions = {},
) {
  const tickets = new Map<string, StoredExecutionTicket>();
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs ?? EXECUTION_TICKET_TTL_MS;

  const removeExpired = (currentTimeMs: number): void => {
    for (const [ticket, record] of tickets) {
      if (record.expiresAtMs <= currentTimeMs) {
        tickets.delete(ticket);
      }
    }
  };

  return {
    issue(tenantId: string): IssuedExecutionTicket {
      const currentTimeMs = now();
      removeExpired(currentTimeMs);

      const ticket = randomBytes(32).toString("base64url");
      const expiresAtMs = currentTimeMs + ttlMs;
      tickets.set(ticket, { tenantId, expiresAtMs });

      return {
        ticket,
        expiresAt: new Date(expiresAtMs).toISOString(),
      };
    },

    /**
     * Consumes a ticket exactly once.
     *
     * The record is removed before the expiry check so a ticket can never be
     * redeemed twice, even when the first attempt arrived after expiry.
     */
    consume(ticket: unknown): { tenantId: string } | null {
      if (typeof ticket !== "string" || ticket.length === 0) {
        return null;
      }

      const record = tickets.get(ticket);

      if (!record) {
        return null;
      }

      tickets.delete(ticket);

      if (record.expiresAtMs <= now()) {
        return null;
      }

      return { tenantId: record.tenantId };
    },

    /** Test helper: drops every stored ticket. */
    clear(): void {
      tickets.clear();
    },

    /** Test helper: number of tickets currently held in memory. */
    size(): number {
      return tickets.size;
    },
  };
}

export type ExecutionTicketService = ReturnType<
  typeof createExecutionTicketService
>;

export const executionTicketService = createExecutionTicketService();
