import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventEmitter } from "node:events";
import { Types } from "mongoose";
import {
  createChangeStreamWatcherService,
  type ActiveWorkflowRecord,
  type ChangeStreamLike,
} from "./changeStreamWatcher.service";
import { APPROVED_EVENT_SOURCE } from "../validators/event-contract.validator";

class FakeChangeStream extends EventEmitter implements ChangeStreamLike {
  public closed = false;
  public closeCalls = 0;

  async close(): Promise<void> {
    this.closeCalls++;
    this.closed = true;
    this.emit("close");
  }
}

function createFakeWorkflow(
  id: string,
  tenantId: Types.ObjectId,
  eventName: string = "order.created",
  filter?: Record<string, unknown>,
  status: "draft" | "active" | "paused" = "active",
): ActiveWorkflowRecord {
  return {
    _id: id,
    tenantId,
    status,
    graph: {
      nodes: [
        {
          type: "trigger",
          data: {
            config: {
              kind: "event",
              source: APPROVED_EVENT_SOURCE,
              eventName,
              filter,
            },
          },
        },
      ],
    },
  };
}

describe("ChangeStreamWatcherService", () => {
  it("dispatches valid matching insert events to the correct workflow", async () => {
    const fakeStream = new FakeChangeStream();
    const tenantId = new Types.ObjectId();
    const eventId = new Types.ObjectId();
    const workflowId = new Types.ObjectId().toString();

    const workflow = createFakeWorkflow(workflowId, tenantId, "order.created", {
      "payload.status": "pending",
    });

    const dispatched: Array<{
      tenantId: Types.ObjectId;
      workflowId: string;
      input: Record<string, unknown>;
    }> = [];

    const watcher = createChangeStreamWatcherService({
      createChangeStream: () => fakeStream,
      findActiveWorkflowsByTenant: async (tId) => {
        return tId.equals(tenantId) ? [workflow] : [];
      },
      startExecution: async (tId, wId, input) => {
        dispatched.push({ tenantId: tId, workflowId: wId, input });
      },
    });

    await watcher.start();

    fakeStream.emit("change", {
      operationType: "insert",
      fullDocument: {
        _id: eventId,
        tenantId,
        eventName: "order.created",
        payload: {
          status: "pending",
          orderId: "ord-1",
        },
      },
    });

    await watcher.stop();

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].workflowId, workflowId);
    assert.equal(dispatched[0].tenantId.toString(), tenantId.toString());
    assert.equal(dispatched[0].input.eventId, eventId.toString());
    assert.equal(dispatched[0].input.eventName, "order.created");
    assert.equal(dispatched[0].input.source, APPROVED_EVENT_SOURCE);
    assert.deepEqual(dispatched[0].input.payload, {
      status: "pending",
      orderId: "ord-1",
    });
  });

  it("ignores non-insert operations (e.g. update, replace, delete)", async () => {
    const fakeStream = new FakeChangeStream();
    const tenantId = new Types.ObjectId();
    let queryCalls = 0;

    const watcher = createChangeStreamWatcherService({
      createChangeStream: () => fakeStream,
      findActiveWorkflowsByTenant: async () => {
        queryCalls++;
        return [];
      },
      startExecution: async () => {},
    });

    await watcher.start();

    fakeStream.emit("change", {
      operationType: "update",
      fullDocument: { _id: new Types.ObjectId(), tenantId, eventName: "order.created" },
    });
    fakeStream.emit("change", {
      operationType: "delete",
      documentKey: { _id: new Types.ObjectId() },
    });
    fakeStream.emit("change", {
      operationType: "replace",
      fullDocument: { _id: new Types.ObjectId(), tenantId, eventName: "order.created" },
    });

    await watcher.stop();

    assert.equal(queryCalls, 0);
  });

  it("safely ignores malformed or missing event documents without crashing", async () => {
    const fakeStream = new FakeChangeStream();
    let dispatchCalls = 0;
    const warnings: string[] = [];

    const watcher = createChangeStreamWatcherService({
      createChangeStream: () => fakeStream,
      findActiveWorkflowsByTenant: async () => [],
      startExecution: async () => {
        dispatchCalls++;
      },
      logger: {
        info: () => {},
        warn: (msg, ...args) => warnings.push([msg, ...args].join(" ")),
        error: () => {},
      },
    });

    await watcher.start();

    // Missing tenantId and eventName
    fakeStream.emit("change", {
      operationType: "insert",
      fullDocument: { _id: new Types.ObjectId() },
    });

    // Not an object
    fakeStream.emit("change", {
      operationType: "insert",
      fullDocument: "malformed",
    });

    await watcher.stop();

    assert.equal(dispatchCalls, 0);
    assert.equal(warnings.length, 2);
  });

  it("does not dispatch when source, event name, or filter do not match", async () => {
    const fakeStream = new FakeChangeStream();
    const tenantId = new Types.ObjectId();
    const workflow = createFakeWorkflow("wf-1", tenantId, "order.created", {
      "payload.status": "pending",
    });

    let dispatchCalls = 0;

    const watcher = createChangeStreamWatcherService({
      createChangeStream: () => fakeStream,
      findActiveWorkflowsByTenant: async () => [workflow],
      startExecution: async () => {
        dispatchCalls++;
      },
    });

    await watcher.start();

    // Mismatched eventName
    fakeStream.emit("change", {
      operationType: "insert",
      fullDocument: {
        _id: new Types.ObjectId(),
        tenantId,
        eventName: "invoice.generated",
        payload: { status: "pending" },
      },
    });

    // Mismatched filter value
    fakeStream.emit("change", {
      operationType: "insert",
      fullDocument: {
        _id: new Types.ObjectId(),
        tenantId,
        eventName: "order.created",
        payload: { status: "completed" },
      },
    });

    await watcher.stop();

    assert.equal(dispatchCalls, 0);
  });

  it("strictly enforces tenant isolation: cross-tenant workflows are never dispatched", async () => {
    const fakeStream = new FakeChangeStream();
    const tenantA = new Types.ObjectId();
    const tenantB = new Types.ObjectId();

    // Workflow belongs to Tenant B
    const workflowTenantB = createFakeWorkflow("wf-b", tenantB, "order.created");

    const dispatched: string[] = [];

    const watcher = createChangeStreamWatcherService({
      createChangeStream: () => fakeStream,
      // If a database query mistakenly returned Tenant B's workflow for Tenant A
      findActiveWorkflowsByTenant: async () => [workflowTenantB],
      startExecution: async (_tId, wId) => {
        dispatched.push(wId);
      },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    await watcher.start();

    // Event belongs to Tenant A
    fakeStream.emit("change", {
      operationType: "insert",
      fullDocument: {
        _id: new Types.ObjectId(),
        tenantId: tenantA,
        eventName: "order.created",
        payload: {},
      },
    });

    await watcher.stop();

    assert.equal(dispatched.length, 0);
  });

  it("does not dispatch inactive (draft or paused) workflows", async () => {
    const fakeStream = new FakeChangeStream();
    const tenantId = new Types.ObjectId();

    const draftWorkflow = createFakeWorkflow("wf-draft", tenantId, "order.created", undefined, "draft");
    const pausedWorkflow = createFakeWorkflow("wf-paused", tenantId, "order.created", undefined, "paused");

    const dispatched: string[] = [];

    const watcher = createChangeStreamWatcherService({
      createChangeStream: () => fakeStream,
      findActiveWorkflowsByTenant: async () => [draftWorkflow, pausedWorkflow],
      startExecution: async (_tId, wId) => {
        dispatched.push(wId);
      },
    });

    await watcher.start();

    fakeStream.emit("change", {
      operationType: "insert",
      fullDocument: {
        _id: new Types.ObjectId(),
        tenantId,
        eventName: "order.created",
        payload: {},
      },
    });

    await watcher.stop();

    assert.equal(dispatched.length, 0);
  });

  it("handles multiple matching workflows for the same event", async () => {
    const fakeStream = new FakeChangeStream();
    const tenantId = new Types.ObjectId();

    const wf1 = createFakeWorkflow("wf-1", tenantId, "order.created");
    const wf2 = createFakeWorkflow("wf-2", tenantId, "order.created");

    const dispatched: string[] = [];

    const watcher = createChangeStreamWatcherService({
      createChangeStream: () => fakeStream,
      findActiveWorkflowsByTenant: async () => [wf1, wf2],
      startExecution: async (_tId, wId) => {
        dispatched.push(wId);
      },
    });

    await watcher.start();

    fakeStream.emit("change", {
      operationType: "insert",
      fullDocument: {
        _id: new Types.ObjectId(),
        tenantId,
        eventName: "order.created",
        payload: {},
      },
    });

    await watcher.stop();

    assert.deepEqual(dispatched, ["wf-1", "wf-2"]);
  });

  it("ensures failure in one workflow execution does not block others or crash the watcher", async () => {
    const fakeStream = new FakeChangeStream();
    const tenantId = new Types.ObjectId();

    const failingWorkflow = createFakeWorkflow("wf-fail", tenantId, "order.created");
    const succeedingWorkflow = createFakeWorkflow("wf-success", tenantId, "order.created");

    const executed: string[] = [];
    const loggedErrors: string[] = [];

    const watcher = createChangeStreamWatcherService({
      createChangeStream: () => fakeStream,
      findActiveWorkflowsByTenant: async () => [failingWorkflow, succeedingWorkflow],
      startExecution: async (_tId, wId) => {
        executed.push(wId);
        if (wId === "wf-fail") {
          throw new Error("Simulated execution failure");
        }
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: (msg) => loggedErrors.push(msg),
      },
    });

    await watcher.start();

    fakeStream.emit("change", {
      operationType: "insert",
      fullDocument: {
        _id: new Types.ObjectId(),
        tenantId,
        eventName: "order.created",
        payload: {},
      },
    });

    await watcher.stop();

    // Both workflows were attempted
    assert.deepEqual(executed, ["wf-fail", "wf-success"]);
    assert.ok(loggedErrors.some((err) => err.includes("Simulated execution failure")));
  });

  it("safely logs and handles stream errors", async () => {
    const fakeStream = new FakeChangeStream();
    const loggedErrors: string[] = [];

    const watcher = createChangeStreamWatcherService({
      createChangeStream: () => fakeStream,
      logger: {
        info: () => {},
        warn: () => {},
        error: (msg, ...args) => loggedErrors.push([msg, ...args].join(" ")),
      },
    });

    await watcher.start();
    fakeStream.emit("error", new Error("Simulated network drop"));
    await watcher.stop();

    assert.ok(loggedErrors.some((err) => err.includes("Simulated network drop")));
  });

  it("stop() closes the stream and handles repeated calls safely", async () => {
    const fakeStream = new FakeChangeStream();

    const watcher = createChangeStreamWatcherService({
      createChangeStream: () => fakeStream,
    });

    await watcher.start();
    assert.equal(watcher.isRunning(), true);

    await watcher.stop();
    assert.equal(watcher.isRunning(), false);
    assert.equal(fakeStream.closed, true);
    assert.equal(fakeStream.closeCalls, 1);

    // Repeated call is safe and idempotent
    await watcher.stop();
    assert.equal(fakeStream.closeCalls, 1);
  });

  it("processes change events strictly sequentially with controlled promises", async () => {
    const fakeStream = new FakeChangeStream();
    const tenantId = new Types.ObjectId();
    const workflow = createFakeWorkflow("wf-seq", tenantId, "order.created");

    const orderOfProcessing: number[] = [];

    // Controlled promises to verify event 1 completes before event 2 starts
    let resolveFirstEvent: () => void = () => {};
    const firstEventGate = new Promise<void>((resolve) => {
      resolveFirstEvent = resolve;
    });

    let currentEvent = 0;

    const watcher = createChangeStreamWatcherService({
      createChangeStream: () => fakeStream,
      findActiveWorkflowsByTenant: async () => [workflow],
      startExecution: async (_tId, _wId, input) => {
        const eventNum = (input.payload as any).sequence as number;
        orderOfProcessing.push(eventNum);

        if (eventNum === 1) {
          // Pause execution of event 1 until released
          await firstEventGate;
        }
      },
    });

    await watcher.start();

    // Emit event 1 and event 2 immediately
    fakeStream.emit("change", {
      operationType: "insert",
      fullDocument: {
        _id: new Types.ObjectId(),
        tenantId,
        eventName: "order.created",
        payload: { sequence: 1 },
      },
    });

    fakeStream.emit("change", {
      operationType: "insert",
      fullDocument: {
        _id: new Types.ObjectId(),
        tenantId,
        eventName: "order.created",
        payload: { sequence: 2 },
      },
    });

    // At this moment, event 1 should be processing and event 2 must NOT have started
    // Let the event loop run a tick
    await new Promise((r) => setImmediate(r));

    assert.deepEqual(orderOfProcessing, [1], "Event 2 must wait for event 1 to finish");

    // Release event 1
    resolveFirstEvent();

    await watcher.stop();

    // Now both have executed in strict sequential order
    assert.deepEqual(orderOfProcessing, [1, 2]);
  });
});
