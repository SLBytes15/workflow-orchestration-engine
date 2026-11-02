import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import {
  computePayloadHash,
  createMemoryIdempotencyDependencies,
  IdempotencyRecoveryWorker,
  IdempotencyService,
  type IdempotencyDependencies,
  type IdempotencyRecord,
} from "./executionIdempotency";

function createMockIdempotencyDependencies() {
  const dependencies = createMemoryIdempotencyDependencies();
  return { dependencies };
}

test("computePayloadHash: produces identical hash for same content with different key order", () => {
  const payload1 = { b: 2, a: 1, c: { y: 20, x: 10 } };
  const payload2 = { a: 1, c: { x: 10, y: 20 }, b: 2 };

  const hash1 = computePayloadHash(payload1);
  const hash2 = computePayloadHash(payload2);

  assert.equal(hash1, hash2);
});

test("computePayloadHash: produces different hash for different content", () => {
  const hash1 = computePayloadHash({ amount: 100 });
  const hash2 = computePayloadHash({ amount: 200 });

  assert.notEqual(hash1, hash2);
});

test("IdempotencyService: handles new, in-flight, and completed records in database store", async () => {
  const { dependencies } = createMockIdempotencyDependencies();
  const service = new IdempotencyService(dependencies);

  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const key = "idemp-key-1";
  const payloadHash = computePayloadHash({ amount: 100 });
  const allocatedExecutionId = new Types.ObjectId();

  // 1. Initial check: should be new
  const check1 = await service.checkIdempotency(tenantId, workflowId, key, payloadHash);
  assert.equal(check1.status, "new");

  // 2. Reserve key atomically
  const reserve = await service.reserveKey(tenantId, workflowId, key, payloadHash, {
    executionId: allocatedExecutionId,
  });
  assert.equal(reserve.status, "new");
  assert.equal(reserve.executionId, String(allocatedExecutionId));

  // 3. Second check while in-flight: should be in_flight
  const check2 = await service.checkIdempotency(tenantId, workflowId, key, payloadHash);
  assert.equal(check2.status, "in_flight");
  if (check2.status === "in_flight") {
    assert.equal(check2.executionId, String(allocatedExecutionId));
  }

  // 4. Mark completed with response body
  const responseBody = { message: "Execution completed", execution: { id: String(allocatedExecutionId) } };
  await service.recordCompleted(tenantId, workflowId, key, payloadHash, allocatedExecutionId, responseBody);

  // 5. Third check: should be match
  const check3 = await service.checkIdempotency(tenantId, workflowId, key, payloadHash);
  assert.equal(check3.status, "match");
  if (check3.status === "match") {
    assert.equal(check3.executionId, String(allocatedExecutionId));
    assert.deepEqual(check3.responseBody, responseBody);
  }
});

test("IdempotencyService: detects payload mismatch for reused key", async () => {
  const { dependencies } = createMockIdempotencyDependencies();
  const service = new IdempotencyService(dependencies);
  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const key = "reused-key";

  const originalHash = computePayloadHash({ amount: 100 });
  const differentHash = computePayloadHash({ amount: 999 });

  await service.reserveKey(tenantId, workflowId, key, originalHash);
  await service.recordCompleted(tenantId, workflowId, key, originalHash, "exec-1", { ok: true });

  const check = await service.checkIdempotency(tenantId, workflowId, key, differentHash);
  assert.equal(check.status, "mismatch");

  const reserveMismatch = await service.reserveKey(tenantId, workflowId, key, differentHash);
  assert.equal(reserveMismatch.status, "mismatch");
});

test("IdempotencyService: scopes keys strictly to tenant and workflow", async () => {
  const { dependencies } = createMockIdempotencyDependencies();
  const service = new IdempotencyService(dependencies);
  const tenantA = new Types.ObjectId();
  const tenantB = new Types.ObjectId();
  const workflowId1 = new Types.ObjectId();
  const workflowId2 = new Types.ObjectId();
  const key = "shared-key-name";
  const payloadHash = computePayloadHash({ test: true });

  await service.reserveKey(tenantA, workflowId1, key, payloadHash);
  await service.recordCompleted(tenantA, workflowId1, key, payloadHash, "exec-A", { id: "exec-A" });

  // Same key for tenant-B should be new
  const checkB = await service.checkIdempotency(tenantB, workflowId1, key, payloadHash);
  assert.equal(checkB.status, "new");

  // Same key for tenant-A but workflowId2 should be new
  const checkWorkflow2 = await service.checkIdempotency(tenantA, workflowId2, key, payloadHash);
  assert.equal(checkWorkflow2.status, "new");
});

test("IdempotencyService: atomically handles duplicate-key race condition (E11000)", async () => {
  const { dependencies } = createMockIdempotencyDependencies();
  const service = new IdempotencyService(dependencies);
  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const key = "race-key";
  const payloadHash = computePayloadHash({ transfer: 500 });

  // Simulate two concurrent reserve calls
  const [res1, res2] = await Promise.all([
    service.reserveKey(tenantId, workflowId, key, payloadHash),
    service.reserveKey(tenantId, workflowId, key, payloadHash),
  ]);

  // One winner gets "new", the other gets "in_flight" via E11000 catch
  const statuses = [res1.status, res2.status].sort();
  assert.deepEqual(statuses, ["in_flight", "new"]);
});

test("IdempotencyService: replaces expired records atomically", async () => {
  const { dependencies } = createMockIdempotencyDependencies();
  const service = new IdempotencyService(dependencies, 100); // 100ms TTL
  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const key = "expiring-key";
  const payloadHash = computePayloadHash({ test: 1 });

  const t0 = new Date("2026-11-02T12:00:00.000Z");
  await service.reserveKey(tenantId, workflowId, key, payloadHash, { now: t0, ttlMs: 1000 });
  await service.recordCompleted(tenantId, workflowId, key, payloadHash, "exec-1", { done: true }, { now: t0, ttlMs: 1000 });

  // 1. Before expiration: should match
  const tBefore = new Date("2026-11-02T12:00:00.500Z");
  const checkBefore = await service.checkIdempotency(tenantId, workflowId, key, payloadHash, { now: tBefore });
  assert.equal(checkBefore.status, "match");

  // 2. After expiration: should be treated as new
  const tAfter = new Date("2026-11-02T12:00:02.000Z"); // 2s later
  const checkAfter = await service.checkIdempotency(tenantId, workflowId, key, payloadHash, { now: tAfter });
  assert.equal(checkAfter.status, "new");

  // 3. Reserving on expired key atomically claims the reservation
  const reserveAfter = await service.reserveKey(tenantId, workflowId, key, payloadHash, { now: tAfter, ttlMs: 1000 });
  assert.equal(reserveAfter.status, "new");
});

test("IdempotencyService: failure release via clearKey allows subsequent retry", async () => {
  const { dependencies } = createMockIdempotencyDependencies();
  const service = new IdempotencyService(dependencies);
  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const key = "fail-release-key";
  const payloadHash = computePayloadHash({ item: "A" });

  // 1. Initial reservation
  const reserve = await service.reserveKey(tenantId, workflowId, key, payloadHash);
  assert.equal(reserve.status, "new");

  // 2. Simulated failure during startExecution -> clearKey called
  await service.clearKey(tenantId, workflowId, key);

  // 3. Retry succeeds because reservation was cleanly released
  const retryReserve = await service.reserveKey(tenantId, workflowId, key, payloadHash);
  assert.equal(retryReserve.status, "new");
});

test("IdempotencyService: persistent store survives simulated server restart", async () => {
  const { dependencies } = createMockIdempotencyDependencies();
  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const key = "restart-audit-key";
  const payloadHash = computePayloadHash({ amount: 100 });

  // Server Instance 1 writes record to database
  const serverInstance1 = new IdempotencyService(dependencies);
  await serverInstance1.reserveKey(tenantId, workflowId, key, payloadHash);
  await serverInstance1.recordCompleted(tenantId, workflowId, key, payloadHash, "exec-100", { persisted: true });

  // Server Instance 2 boots up connecting to the same database
  const serverInstance2 = new IdempotencyService(dependencies);

  // State is preserved from database: returns "match"
  const afterRestart = await serverInstance2.checkIdempotency(tenantId, workflowId, key, payloadHash);
  assert.equal(afterRestart.status, "match");
  if (afterRestart.status === "match") {
    assert.equal(afterRestart.executionId, "exec-100");
    assert.deepEqual(afterRestart.responseBody, { persisted: true });
  }
});

test("reconcileInFlightReservation: missing execution document within grace period is PRESERVED_IN_FLIGHT", async () => {
  const executionsStore = new Map<string, any>();
  const dependencies = createMemoryIdempotencyDependencies(executionsStore);
  const service = new IdempotencyService(dependencies);

  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const key = "fresh-reservation-no-exec";
  const payloadHash = computePayloadHash({ step: 1 });
  const executionId = new Types.ObjectId();
  const t0 = new Date("2026-11-02T12:00:00.000Z");

  await service.reserveKey(tenantId, workflowId, key, payloadHash, {
    executionId,
    now: t0,
  });

  // Reconcile after 1 second (grace period is 5 seconds)
  const t1 = new Date("2026-11-02T12:00:01.000Z");
  const outcome = await service.reconcileInFlightReservation(tenantId, workflowId, key, undefined, {
    now: t1,
    creationGracePeriodMs: 5000,
  });

  assert.equal(outcome.action, "PRESERVE_IN_FLIGHT");
  assert.equal(outcome.executionId, String(executionId));
  if (outcome.action === "PRESERVE_IN_FLIGHT") {
    assert.equal(outcome.executionStatus, "active_pending_creation");
  }
});

test("reconcileInFlightReservation: missing execution document exceeding grace period is RETRY_SAFE", async () => {
  const executionsStore = new Map<string, any>();
  const dependencies = createMemoryIdempotencyDependencies(executionsStore);
  const service = new IdempotencyService(dependencies);

  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const key = "crashed-before-exec-doc";
  const payloadHash = computePayloadHash({ step: 1 });
  const executionId = new Types.ObjectId();
  const t0 = new Date("2026-11-02T12:00:00.000Z");

  await service.reserveKey(tenantId, workflowId, key, payloadHash, {
    executionId,
    now: t0,
  });

  // Reconcile after 10 seconds (exceeding 5s grace period)
  const t1 = new Date("2026-11-02T12:00:10.000Z");
  const outcome = await service.reconcileInFlightReservation(tenantId, workflowId, key, undefined, {
    now: t1,
    creationGracePeriodMs: 5000,
  });

  assert.equal(outcome.action, "RETRY_SAFE");
  assert.equal(outcome.executionId, String(executionId));

  // Subsequent reserveKey now treats it as new and allows retry with same executionId
  const retryReserve = await service.reserveKey(tenantId, workflowId, key, payloadHash, {
    now: t1,
    creationGracePeriodMs: 5000,
  });
  assert.equal(retryReserve.status, "new");
  assert.equal(retryReserve.executionId, String(executionId));
});

test("reconcileInFlightReservation: existing queued execution is PRESERVED_IN_FLIGHT", async () => {
  const executionsStore = new Map<string, any>();
  const dependencies = createMemoryIdempotencyDependencies(executionsStore);
  const service = new IdempotencyService(dependencies);

  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const key = "queued-exec-key";
  const payloadHash = computePayloadHash({ step: 1 });
  const executionId = new Types.ObjectId();

  await service.reserveKey(tenantId, workflowId, key, payloadHash, { executionId });

  // Add queued execution to database
  executionsStore.set(String(executionId), {
    _id: executionId,
    tenantId,
    workflowId,
    workflowVersion: 1,
    status: "queued",
    nodeResults: [],
  });

  const outcome = await service.reconcileInFlightReservation(tenantId, workflowId, key);
  assert.equal(outcome.action, "PRESERVE_IN_FLIGHT");
  assert.equal(outcome.executionId, String(executionId));
  if (outcome.action === "PRESERVE_IN_FLIGHT") {
    assert.equal(outcome.executionStatus, "queued");
  }
});

test("reconcileInFlightReservation: existing running execution is PRESERVED_IN_FLIGHT", async () => {
  const executionsStore = new Map<string, any>();
  const dependencies = createMemoryIdempotencyDependencies(executionsStore);
  const service = new IdempotencyService(dependencies);

  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const key = "running-exec-key";
  const payloadHash = computePayloadHash({ step: 1 });
  const executionId = new Types.ObjectId();

  await service.reserveKey(tenantId, workflowId, key, payloadHash, { executionId });

  // Add running execution
  executionsStore.set(String(executionId), {
    _id: executionId,
    tenantId,
    workflowId,
    workflowVersion: 1,
    status: "running",
    nodeResults: [{ nodeId: "node-1", status: "completed" }],
  });

  const outcome = await service.reconcileInFlightReservation(tenantId, workflowId, key);
  assert.equal(outcome.action, "PRESERVE_IN_FLIGHT");
  assert.equal(outcome.executionId, String(executionId));
  if (outcome.action === "PRESERVE_IN_FLIGHT") {
    assert.equal(outcome.executionStatus, "running");
  }
});

test("reconcileInFlightReservation: existing completed execution reconciles and persists completed response", async () => {
  const executionsStore = new Map<string, any>();
  const dependencies = createMemoryIdempotencyDependencies(executionsStore);
  const service = new IdempotencyService(dependencies);

  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const key = "completed-unrecorded-key";
  const payloadHash = computePayloadHash({ step: 1 });
  const executionId = new Types.ObjectId();

  // 1. Reserved, but crashed before recordCompleted
  await service.reserveKey(tenantId, workflowId, key, payloadHash, { executionId });

  // Execution finished in database
  executionsStore.set(String(executionId), {
    _id: executionId,
    tenantId,
    workflowId,
    workflowVersion: 1,
    status: "completed",
    currentNodeId: null,
    nodeResults: [{ nodeId: "task-1", status: "completed", output: { success: true } }],
    error: null,
    startedAt: new Date(),
    completedAt: new Date(),
    createdAt: new Date(),
  });

  // 2. Reconcile
  const outcome = await service.reconcileInFlightReservation(tenantId, workflowId, key);
  assert.equal(outcome.action, "COMPLETED_RECONCILED");
  assert.equal(outcome.executionId, String(executionId));
  if (outcome.action === "COMPLETED_RECONCILED") {
    assert.equal(outcome.responseBody.message, "Workflow execution completed");
    assert.equal(outcome.responseBody.execution.status, "completed");
  }

  // 3. Subsequent checkIdempotency immediately returns match with cached responseBody
  const check = await service.checkIdempotency(tenantId, workflowId, key, payloadHash);
  assert.equal(check.status, "match");
  if (check.status === "match") {
    assert.equal(check.executionId, String(executionId));
    assert.equal(check.responseBody.execution.status, "completed");
  }
});

test("reconcileInFlightReservation: existing failed execution returns recorded failure outcome per contract", async () => {
  const executionsStore = new Map<string, any>();
  const dependencies = createMemoryIdempotencyDependencies(executionsStore);
  const service = new IdempotencyService(dependencies);

  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const key = "failed-unrecorded-key";
  const payloadHash = computePayloadHash({ step: 1 });
  const executionId = new Types.ObjectId();

  await service.reserveKey(tenantId, workflowId, key, payloadHash, { executionId });

  // Execution recorded as failed in DB
  executionsStore.set(String(executionId), {
    _id: executionId,
    tenantId,
    workflowId,
    workflowVersion: 1,
    status: "failed",
    currentNodeId: "task-2",
    nodeResults: [{ nodeId: "task-1", status: "completed" }, { nodeId: "task-2", status: "failed" }],
    error: { code: "TASK_FAILED", message: "API connection timed out" },
    startedAt: new Date(),
    completedAt: new Date(),
    createdAt: new Date(),
  });

  const outcome = await service.reconcileInFlightReservation(tenantId, workflowId, key);
  assert.equal(outcome.action, "COMPLETED_RECONCILED");
  assert.equal(outcome.executionId, String(executionId));
  if (outcome.action === "COMPLETED_RECONCILED") {
    assert.equal(outcome.responseBody.message, "Workflow execution failed");
    assert.equal(outcome.responseBody.execution.status, "failed");
    assert.equal(outcome.responseBody.execution.error.code, "TASK_FAILED");
  }

  // Re-reserve attempt returns match with failed response body (never re-dispatches!)
  const reReserve = await service.reserveKey(tenantId, workflowId, key, payloadHash);
  assert.equal(reReserve.status, "match");
  if (reReserve.status === "match") {
    assert.equal(reReserve.responseBody.execution.status, "failed");
  }
});

test("reconcileInFlightReservation: existing compensating execution is PRESERVED_IN_FLIGHT", async () => {
  const executionsStore = new Map<string, any>();
  const dependencies = createMemoryIdempotencyDependencies(executionsStore);
  const service = new IdempotencyService(dependencies);

  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const key = "compensating-exec-key";
  const payloadHash = computePayloadHash({ step: 1 });
  const executionId = new Types.ObjectId();

  await service.reserveKey(tenantId, workflowId, key, payloadHash, { executionId });

  executionsStore.set(String(executionId), {
    _id: executionId,
    tenantId,
    workflowId,
    workflowVersion: 1,
    status: "compensating",
    nodeResults: [{ nodeId: "node-1", status: "completed" }],
  });

  const outcome = await service.reconcileInFlightReservation(tenantId, workflowId, key);
  assert.equal(outcome.action, "PRESERVE_IN_FLIGHT");
  assert.equal(outcome.executionId, String(executionId));
  if (outcome.action === "PRESERVE_IN_FLIGHT") {
    assert.equal(outcome.executionStatus, "compensating");
  }
});

test("reconcileInFlightReservation: MongoDB error during lookup returns UNCERTAIN_RETAIN and retains reservation", async () => {
  const dependencies = createMemoryIdempotencyDependencies();
  dependencies.findExecution = async () => {
    throw new Error("MongoNetworkTimeout: connection lost to cluster");
  };
  const service = new IdempotencyService(dependencies);

  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const key = "db-down-key";
  const payloadHash = computePayloadHash({ step: 1 });
  const executionId = new Types.ObjectId();

  await service.reserveKey(tenantId, workflowId, key, payloadHash, { executionId });

  const outcome = await service.reconcileInFlightReservation(tenantId, workflowId, key);
  assert.equal(outcome.action, "UNCERTAIN_RETAIN");
  assert.ok(outcome.error?.includes("MongoNetworkTimeout"));

  // Check that the record in the store was NOT deleted
  const stored = await dependencies.findRecord(tenantId, workflowId, key);
  assert.ok(stored);
  assert.equal(stored.status, "in_flight");
});

test("reconcileInFlightReservation: enforces tenant isolation on execution lookup", async () => {
  const executionsStore = new Map<string, any>();
  const dependencies = createMemoryIdempotencyDependencies(executionsStore);
  const service = new IdempotencyService(dependencies);

  const tenantA = new Types.ObjectId();
  const tenantB = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const key = "tenant-isolation-reconcile";
  const payloadHash = computePayloadHash({ step: 1 });
  const executionId = new Types.ObjectId();

  await service.reserveKey(tenantA, workflowId, key, payloadHash, { executionId });

  // Execution exists in DB, but belongs to tenantB!
  executionsStore.set(String(executionId), {
    _id: executionId,
    tenantId: tenantB,
    workflowId,
    status: "completed",
  });

  // Reconcile under tenantA: tenantA cannot access tenantB's execution
  const t1 = new Date(Date.now() + 10000);
  const outcome = await service.reconcileInFlightReservation(tenantA, workflowId, key, undefined, {
    now: t1,
    creationGracePeriodMs: 5000,
  });

  // Since execution lookup was scoped to tenantA, tenantB's document was not returned.
  // It is treated as missing for tenantA.
  assert.equal(outcome.action, "RETRY_SAFE");
});

test("IdempotencyRecoveryWorker: runs periodically, reconciles stale records, and respects start/stop", async () => {
  const executionsStore = new Map<string, any>();
  const dependencies = createMemoryIdempotencyDependencies(executionsStore);
  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();

  const worker = new IdempotencyRecoveryWorker(tenantId, dependencies, {
    intervalMs: 100,
    creationGracePeriodMs: 1000,
  });

  // Create two in-flight records
  const key1 = "worker-stale-1";
  const key2 = "worker-stale-2";
  const exec1 = new Types.ObjectId();
  const exec2 = new Types.ObjectId();

  const oldTime = new Date(Date.now() - 5000); // 5s ago (older than 1s cutoff)
  await dependencies.createRecord({
    tenantId,
    workflowId,
    key: key1,
    payloadHash: "hash1",
    status: "in_flight",
    executionId: exec1,
    expiresAt: new Date(Date.now() + 60000),
  });
  await dependencies.updateRecord({ tenantId, workflowId, key: key1 }, { $set: { createdAt: oldTime } });

  await dependencies.createRecord({
    tenantId,
    workflowId,
    key: key2,
    payloadHash: "hash2",
    status: "in_flight",
    executionId: exec2,
    expiresAt: new Date(Date.now() + 60000),
  });
  await dependencies.updateRecord({ tenantId, workflowId, key: key2 }, { $set: { createdAt: oldTime } });

  // exec1 finished in DB
  executionsStore.set(String(exec1), {
    _id: exec1,
    tenantId,
    workflowId,
    status: "completed",
    nodeResults: [],
  });

  // exec2 has no execution doc (crashed before createExecution)

  // Run worker once
  const result = await worker.runOnce();
  assert.equal(result.checkedCount, 2);
  assert.equal(result.reconciledCount, 2);

  // Key 1 is now completed
  const rec1 = await dependencies.findRecord(tenantId, workflowId, key1);
  assert.equal(rec1.status, "completed");

  // Lifecycle check: start and stop
  worker.start();
  assert.equal(worker.running, true);
  await worker.stop();
  assert.equal(worker.running, false);
});

test("fencing token: Request A paused -> grace period expires -> Request B reconciles RETRY_SAFE with new token -> Request A is invalidated", async () => {
  const executionsStore = new Map<string, any>();
  const dependencies = createMemoryIdempotencyDependencies(executionsStore);
  const service = new IdempotencyService(dependencies);

  const tenantId = new Types.ObjectId();
  const workflowId = new Types.ObjectId();
  const key = "fencing-race-key";
  const payloadHash = computePayloadHash({ amount: 50 });
  const execIdA = new Types.ObjectId();
  const t0 = new Date("2026-11-02T12:00:00.000Z");

  // 1. Request A reserves the key and receives a reservationToken
  const resA = await service.reserveKey(tenantId, workflowId, key, payloadHash, {
    executionId: execIdA,
    now: t0,
  });
  assert.equal(resA.status, "new");
  assert.ok(resA.reservationToken, "Request A must receive a reservationToken");
  const tokenA = resA.reservationToken;

  // Request A owns the reservation initially
  const isOwnerA1 = await service.validateOwnership(tenantId, workflowId, key, tokenA);
  assert.equal(isOwnerA1, true);

  // 2. Request A pauses. Grace period (5s) expires.
  const t1 = new Date("2026-11-02T12:00:10.000Z"); // 10s later

  // 3. Request B arrives, detects missing execution document after grace period, and reclaims via RETRY_SAFE
  const resB = await service.reserveKey(tenantId, workflowId, key, payloadHash, {
    now: t1,
    creationGracePeriodMs: 5000,
  });
  assert.equal(resB.status, "new");
  assert.ok(resB.reservationToken, "Request B must receive a new reservationToken");
  const tokenB = resB.reservationToken;
  assert.notEqual(tokenA, tokenB, "Request B must receive a fresh, distinct fencing token");

  // 4. Request A resumes and attempts to validate its ownership: it has LOST ownership!
  const isOwnerA2 = await service.validateOwnership(tenantId, workflowId, key, tokenA);
  assert.equal(isOwnerA2, false, "Request A must no longer own the reservation after Request B reclaimed it");

  // 5. Request A attempts clearKey with its old token: clearKey is safely REJECTED (does not delete Request B's reservation)
  const deletedA = await service.clearKey(tenantId, workflowId, key, tokenA);
  assert.equal(deletedA, false, "Request A's clearKey must be rejected because tokenA is stale");

  // Request B's in-flight reservation remains intact
  const recordStillPresent = await dependencies.findRecord(tenantId, workflowId, key);
  assert.ok(recordStillPresent);
  assert.equal(recordStillPresent.status, "in_flight");
  assert.equal(recordStillPresent.reservationToken, tokenB);

  // 6. Request A attempts recordCompleted with its old token: update is safely REJECTED
  await service.recordCompleted(
    tenantId,
    workflowId,
    key,
    payloadHash,
    execIdA,
    { message: "Zombie execution from Request A" },
    { reservationToken: tokenA },
  );

  // Record is still in_flight under Request B's token
  const recordPostZombie = await dependencies.findRecord(tenantId, workflowId, key);
  assert.equal(recordPostZombie.status, "in_flight");

  // 7. Request B completes normally with token B
  const validResponse = { message: "Legitimate execution from Request B" };
  await service.recordCompleted(
    tenantId,
    workflowId,
    key,
    payloadHash,
    execIdA,
    validResponse,
    { reservationToken: tokenB },
  );

  const finalRecord = await dependencies.findRecord(tenantId, workflowId, key);
  assert.equal(finalRecord.status, "completed");
  assert.deepEqual(finalRecord.responseBody, validResponse);
});
