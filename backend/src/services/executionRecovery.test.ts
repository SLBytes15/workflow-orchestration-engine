import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import {
  evaluateExecutionRecovery,
  recoverAbandonedExecution,
  type ExecutionRecoveryAnalysis,
} from "./executionRecovery";
import type { ExecutionServiceDependencies } from "./execution.service";
import type { RuntimeNodeResult } from "./execution.runtime";

const tenantId = new Types.ObjectId("64e35916578810d06389f81a");
const otherTenantId = new Types.ObjectId("64e35916578810d06389f81b");
const executionId = new Types.ObjectId("64e35920578810d06389f81c");

test("evaluateExecutionRecovery: identifies active running executions within grace period as active", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const startedAt = new Date("2026-11-02T11:58:00Z"); // 2 minutes ago (well within default 5m+1m)

  const analysis = evaluateExecutionRecovery(
    {
      status: "running",
      startedAt,
      updatedAt: startedAt,
      nodeResults: [],
    },
    { now },
  );

  assert.equal(analysis.isStale, false);
  assert.equal(analysis.outcome, "REQUIRES_MANUAL_INTERVENTION");
  assert.match(analysis.reason, /within the allowable task timeout/);
});

test("evaluateExecutionRecovery: identifies running execution exceeding timeout + grace as stale and safe to mark failed", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const startedAt = new Date("2026-11-02T11:50:00Z"); // 10 minutes ago (exceeds 5m default + 1m grace)

  const analysis = evaluateExecutionRecovery(
    {
      status: "running",
      startedAt,
      updatedAt: startedAt,
      nodeResults: [],
    },
    { now },
  );

  assert.equal(analysis.isStale, true);
  assert.equal(analysis.outcome, "SAFE_TO_MARK_FAILED");
  assert.equal(analysis.suggestedTerminalStatus, "failed");
  assert.equal(analysis.suggestedError?.code, "EXECUTION_ABANDONED_OR_CRASHED");
  assert.match(analysis.reason, /Forward progress has no checkpoints/);
});

test("evaluateExecutionRecovery: identifies running execution with forward checkpoints and safely marks failed without re-dispatching", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const startedAt = new Date("2026-11-02T11:50:00Z");

  const nodeResults: RuntimeNodeResult[] = [
    {
      nodeId: "trigger-1",
      status: "completed",
      startedAt,
      completedAt: startedAt,
    },
    {
      nodeId: "task-1",
      status: "completed",
      startedAt,
      completedAt: startedAt,
    },
  ];

  const analysis = evaluateExecutionRecovery(
    {
      status: "running",
      startedAt,
      updatedAt: startedAt,
      nodeResults,
    },
    { now },
  );

  assert.equal(analysis.isStale, true);
  assert.equal(analysis.outcome, "SAFE_TO_MARK_FAILED");
  assert.equal(analysis.suggestedTerminalStatus, "failed");
  assert.equal(analysis.suggestedError?.code, "EXECUTION_ABANDONED_WITH_CHECKPOINTS");
  assert.equal(analysis.inFlightNodeId, "task-1");
  assert.match(analysis.reason, /has 2 completed forward checkpoint\(s\) up to 'task-1'/);
});

test("evaluateExecutionRecovery: respects graph-configured task timeout when evaluating staleness", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const startedAt = new Date("2026-11-02T11:45:00Z"); // 15 minutes ago

  // Graph has a long-running task with 20-minute timeout
  const graphSnapshot = {
    nodes: [
      {
        id: "task-long",
        type: "task",
        data: { config: { timeoutMs: 20 * 60 * 1000 } }, // 20m
      },
    ],
  };

  const analysis = evaluateExecutionRecovery(
    {
      status: "running",
      startedAt,
      updatedAt: startedAt,
      nodeResults: [],
      graphSnapshot,
    },
    { now },
  );

  // 15m is within 20m + 1m grace
  assert.equal(analysis.isStale, false);
  assert.equal(analysis.outcome, "REQUIRES_MANUAL_INTERVENTION");
});

test("evaluateExecutionRecovery: queued executions within queue window are safe to resume", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const createdAt = new Date("2026-11-02T11:58:00Z"); // 2 minutes queued

  const analysis = evaluateExecutionRecovery(
    {
      status: "queued",
      createdAt,
    },
    { now },
  );

  assert.equal(analysis.isStale, false);
  assert.equal(analysis.outcome, "SAFE_TO_RESUME");
});

test("evaluateExecutionRecovery: queued executions exceeding maximum queue duration are marked failed", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const createdAt = new Date("2026-11-02T11:40:00Z"); // 20 minutes queued (exceeds 10m default)

  const analysis = evaluateExecutionRecovery(
    {
      status: "queued",
      createdAt,
    },
    { now },
  );

  assert.equal(analysis.isStale, true);
  assert.equal(analysis.outcome, "SAFE_TO_MARK_FAILED");
  assert.equal(analysis.suggestedTerminalStatus, "failed");
  assert.equal(analysis.suggestedError?.code, "QUEUED_EXECUTION_TIMED_OUT");
});

test("evaluateExecutionRecovery: compensating execution with in-flight node requires manual intervention", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const startedAt = new Date("2026-11-02T11:40:00Z");

  const nodeResults: RuntimeNodeResult[] = [
    {
      nodeId: "task-1",
      status: "completed",
      compensation: {
        status: "completed",
        startedAt: null,
        completedAt: null,
        error: null,
      },
    },
    {
      nodeId: "task-2",
      status: "completed",
      compensation: {
        status: "running", // was mid-flight during crash!
        startedAt: new Date("2026-11-02T11:41:00Z"),
        completedAt: null,
        error: null,
      },
    },
  ];

  const analysis = evaluateExecutionRecovery(
    {
      status: "compensating",
      startedAt,
      updatedAt: startedAt,
      nodeResults,
    },
    { now },
  );

  assert.equal(analysis.outcome, "REQUIRES_MANUAL_INTERVENTION");
  assert.equal(analysis.inFlightNodeId, "task-2");
  assert.match(analysis.reason, /partially executed; automatic retry risks duplicate compensation/);
});

test("evaluateExecutionRecovery: compensating execution with pending tasks is safe to continue compensation", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const startedAt = new Date("2026-11-02T11:40:00Z");

  const nodeResults: RuntimeNodeResult[] = [
    {
      nodeId: "task-1",
      status: "completed",
      compensation: {
        status: "pending", // hasn't started yet
        startedAt: null,
        completedAt: null,
        error: null,
      },
    },
    {
      nodeId: "task-2",
      status: "completed",
      compensation: {
        status: "completed", // finished before crash
        startedAt: null,
        completedAt: null,
        error: null,
      },
    },
  ];

  const analysis = evaluateExecutionRecovery(
    {
      status: "compensating",
      startedAt,
      updatedAt: startedAt,
      nodeResults,
    },
    { now },
  );

  assert.equal(analysis.outcome, "SAFE_TO_CONTINUE_COMPENSATION");
  assert.deepEqual(analysis.uncompensatedNodeIds, ["task-1"]);
});

test("evaluateExecutionRecovery: compensating execution where all checkpoints finished finalizes terminal status", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const startedAt = new Date("2026-11-02T11:40:00Z");

  const nodeResults: RuntimeNodeResult[] = [
    {
      nodeId: "task-1",
      status: "completed",
      compensation: {
        status: "completed",
        startedAt: null,
        completedAt: null,
        error: null,
      },
    },
    {
      nodeId: "task-2",
      status: "completed",
      compensation: {
        status: "completed",
        startedAt: null,
        completedAt: null,
        error: null,
      },
    },
  ];

  const analysis = evaluateExecutionRecovery(
    {
      status: "compensating",
      startedAt,
      updatedAt: startedAt,
      nodeResults,
    },
    { now },
  );

  assert.equal(analysis.outcome, "SAFE_TO_MARK_FAILED");
  assert.equal(analysis.suggestedTerminalStatus, "compensated");
  assert.match(analysis.reason, /All node compensations finished/);
});

test("recoverAbandonedExecution: safely updates abandoned execution via CAS filter", async () => {
  let updateFilterPassed: any = null;
  let updatePayloadPassed: any = null;

  const mockDependencies: ExecutionServiceDependencies = {
    findWorkflow: async () => null,
    createExecution: async () => null,
    findExecution: async () => null,
    findHistory: async () => [],
    updateExecution: async (tId, eId, expectedStatus, expectedNodeResults, update) => {
      updateFilterPassed = { tId, eId, expectedStatus, expectedNodeResults };
      updatePayloadPassed = update;
      return {
        _id: eId,
        tenantId: tId,
        status: update.status,
        error: update.error,
        completedAt: update.completedAt,
      };
    },
  };

  const analysis: ExecutionRecoveryAnalysis = {
    outcome: "SAFE_TO_MARK_FAILED",
    isStale: true,
    reason: "Timed out",
    suggestedTerminalStatus: "failed",
    suggestedError: { code: "CRASH_RECOVERED", message: "Process died" },
  };

  const recovered = await recoverAbandonedExecution(
    mockDependencies,
    tenantId,
    executionId,
    analysis,
    "running",
    [],
  );

  assert.equal(recovered.status, "failed");
  assert.deepEqual(recovered.error, { code: "CRASH_RECOVERED", message: "Process died" });
  assert.equal(updateFilterPassed?.tId, tenantId);
  assert.equal(updateFilterPassed?.expectedStatus, "running");
});

test("recoverAbandonedExecution: rejects recovery when analysis outcome is not SAFE_TO_MARK_FAILED", async () => {
  const mockDependencies: ExecutionServiceDependencies = {
    findWorkflow: async () => null,
    createExecution: async () => null,
    findExecution: async () => null,
    findHistory: async () => [],
    updateExecution: async () => null,
  };

  const analysis: ExecutionRecoveryAnalysis = {
    outcome: "REQUIRES_MANUAL_INTERVENTION",
    isStale: true,
    reason: "In flight node",
  };

  await assert.rejects(
    () =>
      recoverAbandonedExecution(
        mockDependencies,
        tenantId,
        executionId,
        analysis,
        "running",
      ),
    /Cannot automatically terminate execution: analysis outcome is 'REQUIRES_MANUAL_INTERVENTION'/,
  );
});

test("recoverAbandonedExecution: enforces tenant isolation on recovery update", async () => {
  let passedTenantId: Types.ObjectId | null = null;

  const mockDependencies: ExecutionServiceDependencies = {
    findWorkflow: async () => null,
    createExecution: async () => null,
    findExecution: async () => null,
    findHistory: async () => [],
    updateExecution: async (tId) => {
      passedTenantId = tId;
      return null; // Simulate mismatched tenant returning null
    },
  };

  const analysis: ExecutionRecoveryAnalysis = {
    outcome: "SAFE_TO_MARK_FAILED",
    isStale: true,
    reason: "Timed out",
    suggestedTerminalStatus: "failed",
  };

  const result = await recoverAbandonedExecution(
    mockDependencies,
    tenantId,
    executionId,
    analysis,
    "running",
  );

  assert.equal(result, null);
  assert.equal(passedTenantId, tenantId);
  assert.notEqual(passedTenantId, otherTenantId);
});
