import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  connectExecutionUpdates,
  parseExecutionUpdateEvent,
  type ExecutionUpdateEvent,
} from "../src/api/executionRealtime";
import {
  matchesExecutionFilters,
  applyRealtimeExecutionUpdate,
  insertIngestedExecution,
} from "../src/executionHelpers";
import type { WorkflowExecution } from "../src/api/executionApi";

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

    const staleMessageHandler = sockets[0].onmessage;
    sockets[0].disconnect();

    staleMessageHandler?.({
      data: JSON.stringify(validEvent),
    } as MessageEvent);

    assert.equal(receivedEvents.length, 1);
    assert.deepEqual(scheduledDelays, [1000]);

    scheduledCallbacks[0]();

    await Promise.resolve();
    await Promise.resolve();

    assert.equal(requestedTickets.length, 2);
    assert.equal(sockets.length, 2);

    sockets[1].open();

    assert.equal(reconnectCount, 1);

    const messageHandlerAfterUnmount = sockets[1].onmessage;

    cleanup();

    assert.equal(sockets[1].closed, true);
    assert.equal(sockets[1].onopen, null);
    assert.equal(sockets[1].onmessage, null);
    assert.equal(sockets[1].onclose, null);
    assert.equal(sockets[1].onerror, null);

    messageHandlerAfterUnmount?.({
      data: JSON.stringify(validEvent),
    } as MessageEvent);

    assert.equal(receivedEvents.length, 1);
  });

  it("reports accurate connection status transitions", async () => {
    const sockets: MockSocket[] = [];
    const statusHistory: string[] = [];

    const cleanup = connectExecutionUpdates({
      apiKey: "test-api-key",
      requestTicket: async () => ({
        ticket: "ticket-status-test",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      }),
      buildUrl: (ticket) => `ws://localhost/ws/executions?ticket=${ticket}`,
      webSocketFactory: () => {
        const socket = new MockSocket();
        sockets.push(socket);
        return socket;
      },
      schedule: (callback) => {
        callback();
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      cancel: () => undefined,
      onEvent: () => undefined,
      onReconnect: () => undefined,
      onStatusChange: (status) => {
        statusHistory.push(status);
      },
    });

    assert.deepEqual(statusHistory, ["connecting"]);

    await Promise.resolve();
    assert.equal(sockets.length, 1);

    sockets[0].open();
    assert.deepEqual(statusHistory, ["connecting", "connected"]);

    sockets[0].disconnect();
    assert.ok(statusHistory.includes("disconnected"));

    cleanup();
    assert.equal(statusHistory[statusHistory.length - 1], "disconnected");
  });
});

describe("execution real-time helper functions", () => {
  const sampleExec1: WorkflowExecution = {
    _id: "exec-1",
    workflowId: "wf-a",
    status: "running",
    createdAt: "2026-10-30T10:00:00.000Z",
    updatedAt: "2026-10-30T10:00:00.000Z",
  };

  const sampleExec2: WorkflowExecution = {
    _id: "exec-2",
    workflowId: "wf-b",
    status: "completed",
    createdAt: "2026-10-30T09:00:00.000Z",
    updatedAt: "2026-10-30T09:30:00.000Z",
  };

  describe("applyRealtimeExecutionUpdate", () => {
    it("updates matching execution in-place immutably and returns wasFound: true", () => {
      const list = [sampleExec1, sampleExec2];
      const event: ExecutionUpdateEvent = {
        type: "execution.completed",
        data: {
          executionId: "exec-1",
          workflowId: "wf-a",
          status: "completed",
          updatedAt: "2026-10-30T10:05:00.000Z",
        },
      };

      const result = applyRealtimeExecutionUpdate(list, event);
      assert.equal(result.wasFound, true);
      assert.equal(result.updatedList.length, 2);
      assert.equal(result.updatedList[0]._id, "exec-1");
      assert.equal(result.updatedList[0].status, "completed");
      assert.equal(result.updatedList[0].updatedAt, "2026-10-30T10:05:00.000Z");
      // Other fields preserved
      assert.equal(result.updatedList[0].createdAt, sampleExec1.createdAt);
      // Original array not mutated
      assert.equal(list[0].status, "running");
    });

    it("returns wasFound: false when execution is not in list", () => {
      const list = [sampleExec1];
      const event: ExecutionUpdateEvent = {
        type: "execution.updated",
        data: {
          executionId: "exec-unseen",
          workflowId: "wf-a",
          status: "running",
          updatedAt: "2026-10-30T10:02:00.000Z",
        },
      };

      const result = applyRealtimeExecutionUpdate(list, event);
      assert.equal(result.wasFound, false);
      assert.equal(result.updatedList, list);
    });
  });

  describe("insertIngestedExecution", () => {
    it("deduplicates and updates if item already exists in list", () => {
      const list = [sampleExec1, sampleExec2];
      const updatedRecord: WorkflowExecution = {
        ...sampleExec1,
        status: "failed",
        error: "Execution crashed",
      };

      const result = insertIngestedExecution(list, updatedRecord);
      assert.equal(result.length, 2);
      assert.equal(result[0]._id, "exec-1");
      assert.equal(result[0].status, "failed");
      assert.equal(result[0].error, "Execution crashed");
    });

    it("inserts newer execution at the top (createdAt DESC)", () => {
      const list = [sampleExec1, sampleExec2];
      const brandNew: WorkflowExecution = {
        _id: "exec-new",
        workflowId: "wf-c",
        status: "running",
        createdAt: "2026-10-30T11:00:00.000Z",
        updatedAt: "2026-10-30T11:00:00.000Z",
      };

      const result = insertIngestedExecution(list, brandNew);
      assert.equal(result.length, 3);
      assert.equal(result[0]._id, "exec-new");
      assert.equal(result[1]._id, "exec-1");
      assert.equal(result[2]._id, "exec-2");
    });

    it("inserts older execution in sorted position (createdAt DESC)", () => {
      const list = [sampleExec1, sampleExec2];
      const older: WorkflowExecution = {
        _id: "exec-old",
        workflowId: "wf-c",
        status: "completed",
        createdAt: "2026-10-30T08:00:00.000Z",
        updatedAt: "2026-10-30T08:10:00.000Z",
      };

      const result = insertIngestedExecution(list, older);
      assert.equal(result.length, 3);
      assert.equal(result[0]._id, "exec-1");
      assert.equal(result[1]._id, "exec-2");
      assert.equal(result[2]._id, "exec-old");
    });

    it("breaks createdAt tie with _id DESC", () => {
      const sameTimeA: WorkflowExecution = {
        _id: "aaa",
        workflowId: "wf-a",
        status: "running",
        createdAt: "2026-10-30T10:00:00.000Z",
      };
      const sameTimeZ: WorkflowExecution = {
        _id: "zzz",
        workflowId: "wf-b",
        status: "running",
        createdAt: "2026-10-30T10:00:00.000Z",
      };

      const result1 = insertIngestedExecution([sameTimeA], sameTimeZ);
      assert.equal(result1[0]._id, "zzz");
      assert.equal(result1[1]._id, "aaa");

      const result2 = insertIngestedExecution([sameTimeZ], sameTimeA);
      assert.equal(result2[0]._id, "zzz");
      assert.equal(result2[1]._id, "aaa");
    });
  });

  describe("matchesExecutionFilters", () => {
    const record: WorkflowExecution = {
      _id: "exec-filter-test",
      workflowId: "wf-target",
      status: "running",
      createdAt: "2026-10-30T10:00:00.000Z",
    };

    it("accepts any workflow when selectedWorkflowId is empty (All workflows mode)", () => {
      assert.equal(
        matchesExecutionFilters(record, { selectedWorkflowId: "", statusFilter: "", fromDate: "", toDate: "" }),
        true,
      );
    });

    it("filters by selectedWorkflowId accurately", () => {
      assert.equal(
        matchesExecutionFilters(record, { selectedWorkflowId: "wf-target", statusFilter: "", fromDate: "", toDate: "" }),
        true,
      );
      assert.equal(
        matchesExecutionFilters(record, { selectedWorkflowId: "wf-other", statusFilter: "", fromDate: "", toDate: "" }),
        false,
      );
    });

    it("filters by statusFilter accurately", () => {
      assert.equal(
        matchesExecutionFilters(record, { selectedWorkflowId: "", statusFilter: "running", fromDate: "", toDate: "" }),
        true,
      );
      assert.equal(
        matchesExecutionFilters(record, { selectedWorkflowId: "", statusFilter: "completed", fromDate: "", toDate: "" }),
        false,
      );
    });

    it("filters by fromDate and toDate accurately", () => {
      // In range
      assert.equal(
        matchesExecutionFilters(record, {
          selectedWorkflowId: "",
          statusFilter: "",
          fromDate: "2026-10-30T09:00:00.000Z",
          toDate: "2026-10-30T11:00:00.000Z",
        }),
        true,
      );

      // Before 'fromDate' -> reject
      assert.equal(
        matchesExecutionFilters(record, {
          selectedWorkflowId: "",
          statusFilter: "",
          fromDate: "2026-10-30T10:30:00.000Z",
          toDate: "",
        }),
        false,
      );

      // After 'toDate' -> reject
      assert.equal(
        matchesExecutionFilters(record, {
          selectedWorkflowId: "",
          statusFilter: "",
          fromDate: "",
          toDate: "2026-10-30T09:30:00.000Z",
        }),
        false,
      );
    });

    it("falls back to startedAt when createdAt is absent", () => {
      const recordWithStartedAt: WorkflowExecution = {
        _id: "exec-started-only",
        workflowId: "wf-target",
        status: "running",
        startedAt: "2026-10-30T10:00:00.000Z",
      };

      assert.equal(
        matchesExecutionFilters(recordWithStartedAt, {
          selectedWorkflowId: "",
          statusFilter: "",
          fromDate: "2026-10-30T09:00:00.000Z",
          toDate: "2026-10-30T11:00:00.000Z",
        }),
        true,
      );
      assert.equal(
        matchesExecutionFilters(recordWithStartedAt, {
          selectedWorkflowId: "",
          statusFilter: "",
          fromDate: "2026-10-30T11:00:00.000Z",
          toDate: "",
        }),
        false,
      );
    });

    it("filters by searchExecutionId accurately", () => {
      assert.equal(
        matchesExecutionFilters(record, {
          searchExecutionId: "exec-filter-test",
        }),
        true,
      );

      assert.equal(
        matchesExecutionFilters(record, {
          searchExecutionId: "exec-different-id",
        }),
        false,
      );

      // Combined search + workflow + status
      assert.equal(
        matchesExecutionFilters(record, {
          searchExecutionId: "exec-filter-test",
          selectedWorkflowId: "wf-target",
          statusFilter: "running",
        }),
        true,
      );

      assert.equal(
        matchesExecutionFilters(record, {
          searchExecutionId: "exec-filter-test",
          selectedWorkflowId: "wf-target",
          statusFilter: "completed",
        }),
        false,
      );
    });
  });
});
