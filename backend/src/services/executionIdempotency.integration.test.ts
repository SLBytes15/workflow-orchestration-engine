import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();
import mongoose, { Types } from "mongoose";
import IdempotencyRecordModel from "../models/idempotencyRecord.model";
import WorkflowExecutionModel from "../models/WorkflowExecution";
import {
  IdempotencyService,
  IdempotencyRecoveryWorker,
  mongoIdempotencyDependencies,
  computePayloadHash,
} from "./executionIdempotency";

test("MongoDB integration: durable idempotency records, compound unique index, and multi-instance sharing", async (t) => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    t.skip("MONGODB_URI not configured, skipping real MongoDB integration test");
    return;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  } catch (err: any) {
    t.skip(`Cannot connect to MongoDB (${err.message}), skipping integration test`);
    return;
  }

  const testTenantId = new Types.ObjectId();
  const testWorkflowId = new Types.ObjectId();
  const testKey = `test-idemp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const testPayload = { action: "transfer", amount: 100 };
  const payloadHash = computePayloadHash(testPayload);
  const allocatedExecutionId = new Types.ObjectId();

  try {
    // 1. Ensure indexes exist on the collection
    await IdempotencyRecordModel.syncIndexes();

    // Verify indexes directly from MongoDB collection
    const collectionIndexes = await IdempotencyRecordModel.collection.indexes();

    const compoundIndex = collectionIndexes.find(
      (idx) =>
        idx.key?.tenantId === 1 &&
        idx.key?.workflowId === 1 &&
        idx.key?.key === 1,
    );
    assert.ok(compoundIndex, "Unique compound index must exist in MongoDB");
    assert.equal(compoundIndex.unique, true, "Compound index must be unique");

    const ttlIndex = collectionIndexes.find(
      (idx) => idx.key?.expiresAt === 1,
    );
    assert.ok(ttlIndex, "TTL index must exist on expiresAt in MongoDB");
    assert.equal(ttlIndex.expireAfterSeconds, 0, "TTL index must have expireAfterSeconds: 0");

    // 2. Direct E11000 duplicate key race check against MongoDB
    const recordA = await IdempotencyRecordModel.create({
      tenantId: testTenantId,
      workflowId: testWorkflowId,
      key: testKey,
      payloadHash,
      status: "in_flight",
      executionId: allocatedExecutionId,
      expiresAt: new Date(Date.now() + 60000),
    });
    assert.ok(recordA._id);

    let duplicateThrewE11000 = false;
    try {
      await IdempotencyRecordModel.create({
        tenantId: testTenantId,
        workflowId: testWorkflowId,
        key: testKey,
        payloadHash,
        status: "in_flight",
        executionId: new Types.ObjectId(),
        expiresAt: new Date(Date.now() + 60000),
      });
    } catch (err: any) {
      if (err.code === 11000 || String(err.message).includes("E11000")) {
        duplicateThrewE11000 = true;
      }
    }
    assert.equal(
      duplicateThrewE11000,
      true,
      "MongoDB compound unique index must reject duplicate with E11000 error",
    );

    // 3. Multi-instance simulation: Instance 1 reserves, Instance 2 checks and completes
    const instance1Service = new IdempotencyService(mongoIdempotencyDependencies);
    const instance2Service = new IdempotencyService(mongoIdempotencyDependencies);

    // Instance 2 queries the in-flight key reserved by Instance 1
    const inFlightCheck = await instance2Service.checkIdempotency(
      testTenantId,
      testWorkflowId,
      testKey,
      payloadHash,
    );
    assert.equal(inFlightCheck.status, "in_flight");
    assert.equal(inFlightCheck.executionId, allocatedExecutionId.toHexString());

    // Payload mismatch detected by Instance 2
    const mismatchCheck = await instance2Service.reserveKey(
      testTenantId,
      testWorkflowId,
      testKey,
      computePayloadHash({ different: "payload" }),
    );
    assert.equal(mismatchCheck.status, "mismatch");

    // Instance 1 completes the execution
    const mockResponseBody = {
      message: "Workflow execution completed",
      execution: {
        id: allocatedExecutionId.toHexString(),
        status: "completed",
      },
    };
    await instance1Service.recordCompleted(
      testTenantId,
      testWorkflowId,
      testKey,
      payloadHash,
      allocatedExecutionId,
      mockResponseBody,
    );

    // Instance 2 (and any other node) queries the key and gets the cached match
    const completedCheck = await instance2Service.reserveKey(
      testTenantId,
      testWorkflowId,
      testKey,
      payloadHash,
    );
    assert.equal(completedCheck.status, "match");
    assert.equal(completedCheck.executionId, allocatedExecutionId.toHexString());
    assert.deepEqual(completedCheck.responseBody, mockResponseBody);

    // 4. Release / Clear Key
    await instance1Service.clearKey(testTenantId, testWorkflowId, testKey);
    const postClearCheck = await instance2Service.checkIdempotency(
      testTenantId,
      testWorkflowId,
      testKey,
      payloadHash,
    );
    assert.equal(postClearCheck.status, "new");
  } finally {
    // Cleanup any lingering test record
    await IdempotencyRecordModel.deleteMany({
      tenantId: testTenantId,
      workflowId: testWorkflowId,
    });
    await mongoose.disconnect();
  }
});

test("MongoDB integration: safe idempotency reconciliation against real WorkflowExecution records", async (t) => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    t.skip("MONGODB_URI not configured, skipping real MongoDB integration test");
    return;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  } catch (err: any) {
    t.skip(`Cannot connect to MongoDB (${err.message}), skipping integration test`);
    return;
  }

  const testTenantId = new Types.ObjectId();
  const testWorkflowId = new Types.ObjectId();
  const service = new IdempotencyService(mongoIdempotencyDependencies);

  try {
    // 1. Reconcile completed execution from MongoDB
    const keyCompleted = `rec-completed-${Date.now()}`;
    const execCompletedId = new Types.ObjectId();
    const payloadHash = computePayloadHash({ query: "reconcile-test" });

    // Step A: In-flight reservation
    await service.reserveKey(testTenantId, testWorkflowId, keyCompleted, payloadHash, {
      executionId: execCompletedId,
    });

    // Step B: Create actual completed WorkflowExecution in MongoDB
    await WorkflowExecutionModel.create({
      _id: execCompletedId,
      tenantId: testTenantId,
      workflowId: testWorkflowId,
      workflowVersion: 1,
      status: "completed",
      graphSnapshot: { version: 1, nodes: [], edges: [] },
      nodeResults: [{ nodeId: "node-1", status: "completed", output: { success: true } }],
      startedAt: new Date(),
      completedAt: new Date(),
    });

    // Step C: Next incoming request encounters in-flight key and reconciles
    const reconciled = await service.reconcileInFlightReservation(
      testTenantId,
      testWorkflowId,
      keyCompleted,
    );
    assert.equal(reconciled.action, "COMPLETED_RECONCILED");
    assert.equal(reconciled.executionId, execCompletedId.toHexString());
    if (reconciled.action === "COMPLETED_RECONCILED") {
      assert.equal(reconciled.responseBody.message, "Workflow execution completed");
      assert.equal(reconciled.responseBody.execution.status, "completed");
    }

    // Subsequent checkIdempotency returns match directly from MongoDB
    const checkMatch = await service.checkIdempotency(testTenantId, testWorkflowId, keyCompleted, payloadHash);
    assert.equal(checkMatch.status, "match");

    // 2. Reconcile missing execution document exceeding creation grace period
    const keyMissing = `rec-missing-${Date.now()}`;
    const execMissingId = new Types.ObjectId();
    const tOld = new Date(Date.now() - 15000); // 15 seconds ago

    await IdempotencyRecordModel.create({
      tenantId: testTenantId,
      workflowId: testWorkflowId,
      key: keyMissing,
      payloadHash,
      status: "in_flight",
      executionId: execMissingId,
      expiresAt: new Date(Date.now() + 60000),
      createdAt: tOld,
      updatedAt: tOld,
    });

    const retryOutcome = await service.reconcileInFlightReservation(
      testTenantId,
      testWorkflowId,
      keyMissing,
      undefined,
      { creationGracePeriodMs: 5000 },
    );
    assert.equal(retryOutcome.action, "RETRY_SAFE");
    assert.equal(retryOutcome.executionId, execMissingId.toHexString());

    // 3. Worker sweeps and reconciles MongoDB in-flight records
    const worker = new IdempotencyRecoveryWorker(testTenantId, mongoIdempotencyDependencies, {
      creationGracePeriodMs: 5000,
    });
    const runResult = await worker.runOnce();
    assert.ok(runResult.checkedCount >= 0);
  } finally {
    await IdempotencyRecordModel.deleteMany({
      tenantId: testTenantId,
      workflowId: testWorkflowId,
    });
    await WorkflowExecutionModel.deleteMany({
      tenantId: testTenantId,
      workflowId: testWorkflowId,
    });
    await mongoose.disconnect();
  }
});

