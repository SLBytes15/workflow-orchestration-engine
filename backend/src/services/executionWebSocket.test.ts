import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { WebSocket } from "ws";

import { createExecutionTicketService } from "./executionTicket.service";
import {
  createExecutionEventHub,
  eventTypeForStatus,
  publishPersistedExecution,
  type ExecutionEventHub,
  type ExecutionEventHubOptions,
} from "./executionWebSocket";

const TENANT_A = "64b7f0c2f1a2b3c4d5e6f701";
const TENANT_B = "64b7f0c2f1a2b3c4d5e6f702";

interface HubHarness {
  hub: ExecutionEventHub;
  tickets: ReturnType<typeof createExecutionTicketService>;
  url: string;
  close(): Promise<void>;
}

async function startHub(
  options: ExecutionEventHubOptions = {},
): Promise<HubHarness> {
  const server: Server = createServer();
  const tickets = createExecutionTicketService();

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Could not determine test server address");
  }

  const hub = createExecutionEventHub({ tickets, ...options });
  hub.attach(server);

  return {
    hub,
    tickets,
    url: `ws://127.0.0.1:${address.port}/ws/executions`,
    async close() {
      await hub.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await delay(10);
  }

  throw new Error(`Timed out waiting for: ${message}`);
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);

    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.once("close", (code: number) => resolve(code));
  });
}

function envelopeFor(tenantLessId: string) {
  return {
    type: "execution.updated" as const,
    data: {
      executionId: tenantLessId,
      workflowId: "64b7f0c2f1a2b3c4d5e6f703",
      status: "running",
      updatedAt: "2026-10-30T10:00:00.000Z",
    },
  };
}

test("rejects a handshake without a ticket", async () => {
  const harness = await startHub();

  try {
    const socket = new WebSocket(harness.url);
    const closed = waitForClose(socket);

    assert.equal(await closed, 4401);
  } finally {
    await harness.close();
  }
});

test("rejects a handshake with an unknown ticket", async () => {
  const harness = await startHub();

  try {
    const socket = new WebSocket(`${harness.url}?ticket=forged-ticket`);
    const closed = waitForClose(socket);

    assert.equal(await closed, 4401);
    assert.equal(harness.hub.connectionCount(TENANT_A), 0);
  } finally {
    await harness.close();
  }
});

test("accepts a single-use ticket and registers the socket for its tenant", async () => {
  const harness = await startHub();

  try {
    const issued = harness.tickets.issue(TENANT_A);
    const socket = await openSocket(`${harness.url}?ticket=${issued.ticket}`);

    await waitUntil(
      () => harness.hub.connectionCount(TENANT_A) === 1,
      "socket registration",
    );

    // The ticket cannot be redeemed a second time.
    const reused = new WebSocket(`${harness.url}?ticket=${issued.ticket}`);
    assert.equal(await waitForClose(reused), 4401);

    socket.close();
  } finally {
    await harness.close();
  }
});

test("delivers an event to the owning tenant only", async () => {
  const harness = await startHub();

  try {
    const socketA = await openSocket(
      `${harness.url}?ticket=${harness.tickets.issue(TENANT_A).ticket}`,
    );
    const socketB = await openSocket(
      `${harness.url}?ticket=${harness.tickets.issue(TENANT_B).ticket}`,
    );

    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];

    socketA.on("message", (data) => receivedA.push(JSON.parse(String(data))));
    socketB.on("message", (data) => receivedB.push(JSON.parse(String(data))));

    await waitUntil(
      () =>
        harness.hub.connectionCount(TENANT_A) === 1 &&
        harness.hub.connectionCount(TENANT_B) === 1,
      "both sockets registered",
    );

    const envelope = envelopeFor("64b7f0c2f1a2b3c4d5e6f704");
    harness.hub.publish(TENANT_A, envelope);

    await waitUntil(() => receivedA.length === 1, "tenant A event");
    await delay(150);

    assert.deepEqual(receivedA, [envelope]);
    assert.deepEqual(receivedB, []);

    socketA.close();
    socketB.close();
  } finally {
    await harness.close();
  }
});

test("delivers an event to every socket of the owning tenant", async () => {
  const harness = await startHub();

  try {
    const sockets = await Promise.all(
      [0, 1].map(() =>
        openSocket(
          `${harness.url}?ticket=${harness.tickets.issue(TENANT_A).ticket}`,
        ),
      ),
    );
    const received = sockets.map(() => [] as unknown[]);

    sockets.forEach((socket, index) => {
      socket.on("message", (data) => received[index].push(JSON.parse(String(data))));
    });

    await waitUntil(
      () => harness.hub.connectionCount(TENANT_A) === 2,
      "both tenant sockets registered",
    );

    const envelope = envelopeFor("64b7f0c2f1a2b3c4d5e6f705");
    harness.hub.publish(TENANT_A, envelope);

    await waitUntil(
      () => received.every((events) => events.length === 1),
      "event on both sockets",
    );

    assert.deepEqual(received, [[envelope], [envelope]]);

    sockets.forEach((socket) => socket.close());
  } finally {
    await harness.close();
  }
});

test("removes a closed socket from the tenant registry", async () => {
  const harness = await startHub();

  try {
    const socket = await openSocket(
      `${harness.url}?ticket=${harness.tickets.issue(TENANT_A).ticket}`,
    );

    await waitUntil(
      () => harness.hub.connectionCount(TENANT_A) === 1,
      "socket registration",
    );

    socket.close();

    await waitUntil(
      () => harness.hub.connectionCount(TENANT_A) === 0,
      "socket cleanup after close",
    );

    // Publishing after cleanup must not resurrect the socket.
    harness.hub.publish(TENANT_A, envelopeFor("64b7f0c2f1a2b3c4d5e6f706"));
    assert.equal(harness.hub.tenantCount(), 0);
  } finally {
    await harness.close();
  }
});

test("publishing without any connected socket is a no-op", async () => {
  const harness = await startHub();

  try {
    assert.doesNotThrow(() => {
      harness.hub.publish(TENANT_A, envelopeFor("64b7f0c2f1a2b3c4d5e6f707"));
    });
    assert.equal(harness.hub.connectionCount(TENANT_A), 0);
  } finally {
    await harness.close();
  }
});

test("close() terminates sockets and clears the registry", async () => {
  const harness = await startHub();
  const socket = await openSocket(
    `${harness.url}?ticket=${harness.tickets.issue(TENANT_A).ticket}`,
  );

  await waitUntil(
    () => harness.hub.connectionCount(TENANT_A) === 1,
    "socket registration",
  );

  const closed = waitForClose(socket);
  await harness.close();

  await closed;
  assert.equal(harness.hub.connectionCount(TENANT_A), 0);
  assert.equal(harness.hub.tenantCount(), 0);
});

test("attach() reuses the existing server instead of opening a second listener", async () => {
  const harness = await startHub();

  try {
    const first = harness.hub.attach(createServer());
    const second = harness.hub.attach(createServer());

    assert.equal(first, second);
  } finally {
    await harness.close();
  }
});

test("maps each persisted status to the approved event type", () => {
  assert.equal(eventTypeForStatus("queued"), "execution.updated");
  assert.equal(eventTypeForStatus("running"), "execution.updated");
  assert.equal(eventTypeForStatus("compensating"), "execution.updated");
  assert.equal(eventTypeForStatus("completed"), "execution.completed");
  assert.equal(eventTypeForStatus("failed"), "execution.failed");

  // Unapproved compensation mappings must not be invented.
  assert.equal(eventTypeForStatus("compensated"), null);
  assert.equal(eventTypeForStatus("compensation_failed"), null);
  assert.equal(eventTypeForStatus("unknown"), null);
});

test("publishes the approved envelope with an ISO timestamp", () => {
  const sent: Array<{ tenantId: string; envelope: unknown }> = [];
  const hub = {
    publish(tenantId: string, envelope: unknown) {
      sent.push({ tenantId, envelope });
    },
  } as unknown as ExecutionEventHub;

  publishPersistedExecution(hub, {
    _id: "64b7f0c2f1a2b3c4d5e6f708",
    tenantId: TENANT_A,
    workflowId: "64b7f0c2f1a2b3c4d5e6f709",
    status: "failed",
    updatedAt: new Date("2026-10-30T09:30:00.000Z"),
  });

  assert.deepEqual(sent, [
    {
      tenantId: TENANT_A,
      envelope: {
        type: "execution.failed",
        data: {
          executionId: "64b7f0c2f1a2b3c4d5e6f708",
          workflowId: "64b7f0c2f1a2b3c4d5e6f709",
          status: "failed",
          updatedAt: "2026-10-30T09:30:00.000Z",
        },
      },
    },
  ]);
});

test("does not publish a compensated status without an approved mapping", () => {
  const sent: unknown[] = [];
  const hub = {
    publish(...args: unknown[]) {
      sent.push(args);
    },
  } as unknown as ExecutionEventHub;

  publishPersistedExecution(hub, {
    _id: "64b7f0c2f1a2b3c4d5e6f70a",
    tenantId: TENANT_A,
    workflowId: "64b7f0c2f1a2b3c4d5e6f70b",
    status: "compensated",
  });

  assert.deepEqual(sent, []);
});

test("never throws when the publisher itself fails", () => {
  const hub = {
    publish() {
      throw new Error("socket exploded");
    },
  } as unknown as ExecutionEventHub;

  assert.doesNotThrow(() => {
    publishPersistedExecution(hub, {
      _id: "64b7f0c2f1a2b3c4d5e6f70c",
      tenantId: TENANT_A,
      workflowId: "64b7f0c2f1a2b3c4d5e6f70d",
      status: "completed",
    });
  });
});
