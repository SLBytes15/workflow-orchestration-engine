import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  connectExecutionUpdates,
  parseExecutionUpdateEvent,
} from "../src/api/executionRealtime";

class MockSocket {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  close() {
    this.closed = true;
  }

  open() {
    this.onopen?.({} as Event);
  }

  sendMessage(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }

  disconnect() {
    this.onclose?.({} as CloseEvent);
  }
}

const validEvent = {
  type: "execution.updated",
  data: {
    executionId: "execution-1",
    workflowId: "workflow-1",
    status: "running",
    updatedAt: "2026-10-30T10:00:00.000Z",
  },
};

describe("execution WebSocket event validation", () => {
  it("accepts a valid event using an existing execution status", () => {
    assert.deepEqual(
      parseExecutionUpdateEvent(JSON.stringify(validEvent)),
      validEvent,
    );
  });

  it("rejects unknown event names and unknown statuses", () => {
    assert.equal(
      parseExecutionUpdateEvent({
        ...validEvent,
        type: "execution.deleted",
      }),
      null,
    );

    assert.equal(
      parseExecutionUpdateEvent({
        ...validEvent,
        data: { ...validEvent.data, status: "paused" },
      }),
      null,
    );
  });

  it("rejects malformed JSON and incomplete payloads", () => {
    assert.equal(parseExecutionUpdateEvent("{invalid"), null);
    assert.equal(
      parseExecutionUpdateEvent({
        type: "execution.updated",
        data: { executionId: "execution-1" },
      }),
      null,
    );
  });
});

describe("execution WebSocket connection manager", () => {
  it("requests a fresh ticket after disconnect and invokes the reconnect callback", async () => {
    const sockets: MockSocket[] = [];
    const requestedTickets: string[] = [];
    const scheduledCallbacks: Array<() => void> = [];
    const scheduledDelays: number[] = [];
    const receivedEvents: unknown[] = [];
    let reconnectCount = 0;

    const cleanup = connectExecutionUpdates({
      apiKey: "test-api-key",

      requestTicket: async () => {
        const ticket = `ticket-${requestedTickets.length + 1}`;
        requestedTickets.push(ticket);

        return {
          ticket,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        };
      },

      buildUrl: (ticket) => `ws://localhost/ws/executions?ticket=${ticket}`,

      webSocketFactory: () => {
        const socket = new MockSocket();
        sockets.push(socket);
        return socket;
      },

      schedule: (callback, delay) => {
        scheduledCallbacks.push(callback);
        scheduledDelays.push(delay);
        return scheduledCallbacks.length as unknown as ReturnType<typeof setTimeout>;
      },

      cancel: () => undefined,

      onEvent: (event) => receivedEvents.push(event),
      onReconnect: () => {
        reconnectCount += 1;
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    assert.equal(requestedTickets.length, 1);
    assert.equal(sockets.length, 1);

    sockets[0].open();
    sockets[0].sendMessage(JSON.stringify(validEvent));

    assert.equal(receivedEvents.length, 1);

    sockets[0].disconnect();

    assert.deepEqual(scheduledDelays, [1000]);

    scheduledCallbacks[0]();

    await Promise.resolve();
    await Promise.resolve();

    assert.equal(requestedTickets.length, 2);
    assert.equal(sockets.length, 2);

    sockets[1].open();

    assert.equal(reconnectCount, 1);

    cleanup();

    assert.equal(sockets[1].closed, true);
  });
});