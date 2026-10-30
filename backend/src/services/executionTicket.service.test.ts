import assert from "node:assert/strict";
import test from "node:test";
import {
  createExecutionTicketService,
  EXECUTION_TICKET_TTL_MS,
} from "./executionTicket.service";

const TENANT_A = "64b7f0c2f1a2b3c4d5e6f701";
const TENANT_B = "64b7f0c2f1a2b3c4d5e6f702";

function createClock(startMs = 1_700_000_000_000) {
  let current = startMs;

  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

test("issues a 32-byte base64url ticket bound to the tenant", () => {
  const service = createExecutionTicketService();
  const issued = service.issue(TENANT_A);

  // 32 random bytes encode to 43 base64url characters without padding.
  assert.equal(issued.ticket.length, 43);
  assert.match(issued.ticket, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!issued.ticket.includes(TENANT_A));
  assert.deepEqual(service.consume(issued.ticket), { tenantId: TENANT_A });
});

test("reports the agreed 60-second expiry as an ISO timestamp", () => {
  const clock = createClock();
  const service = createExecutionTicketService({ now: clock.now });
  const issued = service.issue(TENANT_A);

  assert.equal(
    issued.expiresAt,
    new Date(clock.now() + EXECUTION_TICKET_TTL_MS).toISOString(),
  );
  assert.equal(
    Date.parse(issued.expiresAt) - clock.now(),
    EXECUTION_TICKET_TTL_MS,
  );
});

test("does not repeat ticket values across issue calls", () => {
  const service = createExecutionTicketService();
  const tickets = new Set<string>();

  for (let index = 0; index < 200; index += 1) {
    tickets.add(service.issue(TENANT_A).ticket);
  }

  assert.equal(tickets.size, 200);
});

test("accepts a ticket immediately before expiry and rejects it at expiry", () => {
  const clock = createClock();
  const service = createExecutionTicketService({ now: clock.now });

  const before = service.issue(TENANT_A);
  clock.advance(EXECUTION_TICKET_TTL_MS - 1);
  assert.deepEqual(service.consume(before.ticket), { tenantId: TENANT_A });

  const atBoundary = service.issue(TENANT_B);
  clock.advance(EXECUTION_TICKET_TTL_MS);
  assert.equal(service.consume(atBoundary.ticket), null);
});

test("rejects a reused ticket on the second redemption", () => {
  const service = createExecutionTicketService();
  const issued = service.issue(TENANT_A);

  assert.deepEqual(service.consume(issued.ticket), { tenantId: TENANT_A });
  assert.equal(service.consume(issued.ticket), null);
  assert.equal(service.size(), 0);
});

test("drops an expired ticket instead of leaving it redeemable", () => {
  const clock = createClock();
  const service = createExecutionTicketService({ now: clock.now });
  const issued = service.issue(TENANT_A);

  clock.advance(EXECUTION_TICKET_TTL_MS);
  assert.equal(service.consume(issued.ticket), null);
  // The failed redemption consumed the record, so it cannot be retried later.
  assert.equal(service.consume(issued.ticket), null);
  assert.equal(service.size(), 0);
});

test("rejects missing, empty and non-string tickets without throwing", () => {
  const service = createExecutionTicketService();

  assert.equal(service.consume(undefined), null);
  assert.equal(service.consume(null), null);
  assert.equal(service.consume(""), null);
  assert.equal(service.consume(42), null);
  assert.equal(service.consume({ ticket: "x" }), null);
  assert.equal(service.consume("not-a-real-ticket"), null);
});

test("purges expired tickets when a new ticket is issued", () => {
  const clock = createClock();
  const service = createExecutionTicketService({ now: clock.now });

  service.issue(TENANT_A);
  assert.equal(service.size(), 1);

  clock.advance(EXECUTION_TICKET_TTL_MS);
  service.issue(TENANT_B);

  assert.equal(service.size(), 1);
});

test("clear() removes every stored ticket", () => {
  const service = createExecutionTicketService();
  const issued = service.issue(TENANT_A);

  service.clear();

  assert.equal(service.size(), 0);
  assert.equal(service.consume(issued.ticket), null);
});
