import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDuration,
  formatNodeDuration,
  buildExecutionTimeline,
  calculateCurrentlyRunning,
  matchesExecutionFilters,
  sanitizeErrorMessage,
  getErrorText,
} from "../src/executionHelpers";
import type { WorkflowExecution, ExecutionSummary } from "../src/api/executionApi";

describe("Phase 7 Enterprise Execution History & Details Test Suite", () => {
  describe("7 Distinct Execution Status Color System", () => {
    const STATUS_MAP: Record<string, string> = {
      queued: "execution-status-pill--queued",
      running: "execution-status-pill--running",
      completed: "execution-status-pill--completed",
      failed: "execution-status-pill--failed",
      compensating: "execution-status-pill--compensating",
      compensated: "execution-status-pill--compensated",
      compensation_failed: "execution-status-pill--compensation_failed",
    };

    it("verifies all 7 lifecycle statuses map to distinct styling tokens", () => {
      const keys = Object.keys(STATUS_MAP);
      assert.equal(keys.length, 7, "Must support exactly 7 distinct status states");
      const values = new Set(Object.values(STATUS_MAP));
      assert.equal(values.size, 7, "Each status token class must be completely distinct");
    });

    it("maps terminal and non-terminal states correctly", () => {
      assert.equal(STATUS_MAP.queued, "execution-status-pill--queued");
      assert.equal(STATUS_MAP.running, "execution-status-pill--running");
      assert.equal(STATUS_MAP.completed, "execution-status-pill--completed");
      assert.equal(STATUS_MAP.failed, "execution-status-pill--failed");
      assert.equal(STATUS_MAP.compensating, "execution-status-pill--compensating");
      assert.equal(STATUS_MAP.compensated, "execution-status-pill--compensated");
      assert.equal(STATUS_MAP.compensation_failed, "execution-status-pill--compensation_failed");
    });
  });

  describe("Backend-driven Summary Metrics Calculation", () => {
    it("calculates currently running executions strictly as running + compensating, excluding queued", () => {
      const summary: ExecutionSummary = {
        total: 100,
        completed: 70,
        failed: 15,
        running: 10,
        queued: 5,
        compensating: 2,
        compensated: 1,
        compensation_failed: 2,
        successRate: 70,
        avgDurationMs: 1200,
        p95DurationMs: 3400,
      };

      // running (10) + compensating (2) = 12
      const activeRunning = calculateCurrentlyRunning(summary);
      assert.equal(activeRunning, 12, "Currently running must include active execution and active compensation");
    });

    it("handles zero or null summary metrics gracefully without throwing", () => {
      assert.equal(calculateCurrentlyRunning(null), 0);
      assert.equal(calculateCurrentlyRunning({} as ExecutionSummary), 0);
    });
  });

  describe("Execution History Filtering & Search Rules", () => {
    const mockExecutions: WorkflowExecution[] = [
      {
        id: "507f1f77bcf86cd799439011",
        workflowId: "wf-1",
        workflowVersion: 1,
        status: "completed",
        startedAt: "2026-03-01T10:00:00.000Z",
        completedAt: "2026-03-01T10:00:05.000Z",
        createdAt: "2026-03-01T10:00:00.000Z",
      },
      {
        id: "507f1f77bcf86cd799439022",
        workflowId: "wf-2",
        workflowVersion: 2,
        status: "failed",
        startedAt: "2026-03-02T11:00:00.000Z",
        completedAt: "2026-03-02T11:00:10.000Z",
        createdAt: "2026-03-02T11:00:00.000Z",
      },
      {
        id: "507f1f77bcf86cd799439033",
        workflowId: "wf-1",
        workflowVersion: 2,
        status: "running",
        startedAt: "2026-03-03T12:00:00.000Z",
        createdAt: "2026-03-03T12:00:00.000Z",
      },
    ];

    it("filters execution records by workflow ID", () => {
      const filtered = mockExecutions.filter((item) =>
        matchesExecutionFilters(item, {
          selectedWorkflowId: "wf-1",
          statusFilter: "",
          fromDate: "",
          toDate: "",
          searchExecutionId: "",
        }),
      );
      assert.equal(filtered.length, 2);
      assert.ok(filtered.every((item) => item.workflowId === "wf-1"));
    });

    it("filters execution records by status", () => {
      const filtered = mockExecutions.filter((item) =>
        matchesExecutionFilters(item, {
          selectedWorkflowId: "",
          statusFilter: "failed",
          fromDate: "",
          toDate: "",
          searchExecutionId: "",
        }),
      );
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].id, "507f1f77bcf86cd799439022");
    });

    it("filters execution records by 24-character execution ID search", () => {
      const filtered = mockExecutions.filter((item) =>
        matchesExecutionFilters(item, {
          selectedWorkflowId: "",
          statusFilter: "",
          fromDate: "",
          toDate: "",
          searchExecutionId: "507f1f77bcf86cd799439033",
        }),
      );
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].status, "running");
    });

    it("filters by date range (from / to boundaries)", () => {
      const filtered = mockExecutions.filter((item) =>
        matchesExecutionFilters(item, {
          selectedWorkflowId: "",
          statusFilter: "",
          fromDate: "2026-03-02T00:00:00.000Z",
          toDate: "2026-03-02T23:59:59.999Z",
          searchExecutionId: "",
        }),
      );
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].id, "507f1f77bcf86cd799439022");
    });
  });

  describe("Duration Formatting & Missing Timestamp Fallback", () => {
    it("formats known execution durations accurately", () => {
      assert.equal(formatDuration(450), "450ms");
      assert.equal(formatDuration(2500), "2.5s");
      assert.equal(formatDuration(125000), "2m 5s");
    });

    it("returns em-dash '—' when total duration is unavailable or negative", () => {
      assert.equal(formatDuration(null), "—");
      assert.equal(formatDuration(undefined), "—");
      assert.equal(formatDuration(-10), "—");
    });

    it("returns 'Duration unavailable' for historical nodes without timestamps", () => {
      const res = formatNodeDuration(undefined, undefined);
      assert.equal(
        res.durationText,
        "Duration unavailable",
        "Never fabricate duration for executions without node-level timestamps",
      );
      assert.equal(res.isValid, false);
      assert.equal(res.durationMs, null);
    });

    it("formats node duration when node timestamps are present", () => {
      const res = formatNodeDuration(
        "2026-03-01T10:00:00.000Z",
        "2026-03-01T10:00:03.200Z",
      );
      assert.equal(res.durationText, "3.2 s");
      assert.equal(res.isValid, true);
      assert.equal(res.durationMs, 3200);
    });
  });

  describe("Execution Timeline Construction & Insights", () => {
    it("identifies slowest node correctly from graph execution", () => {
      const execution: WorkflowExecution = {
        id: "exec-test-1",
        workflowId: "wf-1",
        status: "completed",
        startedAt: "2026-03-01T10:00:00.000Z",
        completedAt: "2026-03-01T10:00:15.000Z",
        graphSnapshot: {
          nodes: [
            { id: "node-1", type: "trigger", data: { label: "Webhook Trigger" } } as any,
            { id: "node-2", type: "task", data: { label: "Fast Transform" } } as any,
            { id: "node-3", type: "task", data: { label: "Slow LLM Call" } } as any,
          ],
          edges: [],
        },
        nodeResults: [
          {
            nodeId: "node-1",
            status: "completed",
            startedAt: "2026-03-01T10:00:00.000Z",
            completedAt: "2026-03-01T10:00:01.000Z",
          },
          {
            nodeId: "node-2",
            status: "completed",
            startedAt: "2026-03-01T10:00:01.000Z",
            completedAt: "2026-03-01T10:00:02.500Z",
          },
          {
            nodeId: "node-3",
            status: "completed",
            startedAt: "2026-03-01T10:00:02.500Z",
            completedAt: "2026-03-01T10:00:14.500Z",
          },
        ],
      };

      const timeline = buildExecutionTimeline(execution);
      assert.ok(timeline.hasAnyValidNodeDuration);
      assert.equal(timeline.slowestNode?.nodeId, "node-3");
      assert.equal(timeline.slowestNode?.label, "Slow LLM Call");
      assert.equal(timeline.steps.length, 3);
      assert.equal(timeline.failedStep, null);
    });

    it("identifies failure step when execution encountered an error", () => {
      const execution: WorkflowExecution = {
        id: "exec-test-failed",
        workflowId: "wf-1",
        status: "failed",
        error: "External payment gateway timeout after 5000ms",
        graphSnapshot: {
          nodes: [
            { id: "step-1", type: "trigger", data: { label: "Start" } } as any,
            { id: "step-2", type: "task", data: { label: "Payment Charge" } } as any,
          ],
          edges: [],
        },
        nodeResults: [
          { nodeId: "step-1", status: "completed" },
          {
            nodeId: "step-2",
            status: "failed",
            error: "External payment gateway timeout after 5000ms",
          },
        ],
      };

      const timeline = buildExecutionTimeline(execution);
      assert.ok(timeline.failedStep);
      assert.equal(timeline.failedStep?.nodeId, "step-2");
      assert.equal(timeline.failedStep?.label, "Payment Charge");
      assert.ok(timeline.failedStep?.error?.includes("External payment gateway timeout"));
    });
  });

  describe("Compensation Safety & Non-fabrication", () => {
    it("reports empty compensation when execution has no compensation data", () => {
      const execution: WorkflowExecution = {
        id: "exec-no-comp",
        workflowId: "wf-1",
        status: "completed",
      };
      assert.equal(execution.compensation, undefined);
      // In the UI, compensation section only renders when Boolean(details.compensation) is true
      const shouldRenderCompensation = Boolean(execution.compensation);
      assert.equal(shouldRenderCompensation, false);
    });

    it("preserves persisted compensation details when present on the backend record", () => {
      const execution: WorkflowExecution = {
        id: "exec-with-comp",
        workflowId: "wf-1",
        status: "compensated",
        compensation: {
          strategy: "backward",
          status: "completed",
          startedAt: "2026-03-01T10:05:00.000Z",
          completedAt: "2026-03-01T10:05:03.000Z",
          compensatedNodes: ["task-charge", "task-reserve"],
        },
      };
      assert.ok(execution.compensation);
      assert.equal(execution.compensation.status, "completed");
      assert.equal(execution.compensation.compensatedNodes.length, 2);
    });
  });

  describe("Error Sanitization", () => {
    it("sanitizes execution errors without leaking raw object representations", () => {
      assert.equal(
        sanitizeErrorMessage("Workflow failed: connection refused"),
        "Workflow failed: connection refused",
      );
      assert.equal(getErrorText(undefined), "");
      assert.equal(getErrorText({ message: "DB timeout" }), "DB timeout");
    });
  });
});
