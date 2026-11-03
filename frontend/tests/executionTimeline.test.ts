import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatNodeDuration,
  buildExecutionTimeline,
} from "../src/executionHelpers";
import type { WorkflowExecution } from "../src/api/executionApi";

describe("execution timeline and node duration insights", () => {
  describe("formatNodeDuration", () => {
    it("returns 'Duration unavailable' when timestamps are missing", () => {
      const res1 = formatNodeDuration(null, null);
      assert.equal(res1.durationText, "Duration unavailable");
      assert.equal(res1.durationMs, null);
      assert.equal(res1.isValid, false);

      const res2 = formatNodeDuration("2026-10-29T10:00:00.000Z", undefined);
      assert.equal(res2.durationText, "Duration unavailable");
      assert.equal(res2.isValid, false);

      const res3 = formatNodeDuration(undefined, "2026-10-29T10:00:01.000Z");
      assert.equal(res3.durationText, "Duration unavailable");
      assert.equal(res3.isValid, false);
    });

    it("returns 'Duration unavailable' when timestamps are invalid non-date strings", () => {
      const res = formatNodeDuration("invalid-start", "2026-10-29T10:00:00.000Z");
      assert.equal(res.durationText, "Duration unavailable");
      assert.equal(res.isValid, false);
    });

    it("returns 'Duration unavailable' when timestamps are reversed (completedAt < startedAt)", () => {
      const res = formatNodeDuration(
        "2026-10-29T10:00:05.000Z",
        "2026-10-29T10:00:01.000Z",
      );
      assert.equal(res.durationText, "Duration unavailable");
      assert.equal(res.durationMs, null);
      assert.equal(res.isValid, false);
    });

    it("formats sub-second durations accurately in milliseconds", () => {
      const res = formatNodeDuration(
        "2026-10-29T10:00:00.000Z",
        "2026-10-29T10:00:00.120Z",
      );
      assert.equal(res.durationText, "120 ms");
      assert.equal(res.durationMs, 120);
      assert.equal(res.isValid, true);
    });

    it("formats seconds durations accurately", () => {
      const res = formatNodeDuration(
        "2026-10-29T10:00:00.000Z",
        "2026-10-29T10:00:02.400Z",
      );
      assert.equal(res.durationText, "2.4 s");
      assert.equal(res.durationMs, 2400);
      assert.equal(res.isValid, true);
    });

    it("formats multi-minute durations accurately", () => {
      const res = formatNodeDuration(
        "2026-10-29T10:00:00.000Z",
        "2026-10-29T10:01:12.000Z",
      );
      assert.equal(res.durationText, "1 minute 12 seconds");
      assert.equal(res.durationMs, 72000);
      assert.equal(res.isValid, true);
    });
  });

  describe("buildExecutionTimeline", () => {
    it("preserves exact execution sequence from nodeResults", () => {
      const execution: WorkflowExecution = {
        _id: "exec-seq-test",
        workflowId: "wf-seq",
        status: "completed",
        startedAt: "2026-10-29T10:00:00.000Z",
        completedAt: "2026-10-29T10:00:05.000Z",
        graphSnapshot: {
          nodes: [
            { id: "step-c", type: "task", data: { label: "Step Charlie" } },
            { id: "step-a", type: "trigger", data: { label: "Step Alpha" } },
            { id: "step-b", type: "condition", data: { label: "Step Bravo" } },
          ],
        },
        nodeResults: [
          { nodeId: "step-a", status: "completed" },
          { nodeId: "step-b", status: "completed", output: { result: true } },
          { nodeId: "step-c", status: "completed" },
        ],
      };

      const timeline = buildExecutionTimeline(execution);
      assert.equal(timeline.steps.length, 3);
      assert.equal(timeline.steps[0].stepNumber, 1);
      assert.equal(timeline.steps[0].nodeId, "step-a");
      assert.equal(timeline.steps[0].label, "Step Alpha");
      assert.equal(timeline.steps[0].nodeType, "trigger");

      assert.equal(timeline.steps[1].stepNumber, 2);
      assert.equal(timeline.steps[1].nodeId, "step-b");
      assert.equal(timeline.steps[1].label, "Step Bravo");
      assert.equal(timeline.steps[1].nodeType, "condition");

      assert.equal(timeline.steps[2].stepNumber, 3);
      assert.equal(timeline.steps[2].nodeId, "step-c");
      assert.equal(timeline.steps[2].label, "Step Charlie");
      assert.equal(timeline.steps[2].nodeType, "task");
    });

    it("falls back gracefully when graphSnapshot is missing or incomplete", () => {
      const execution: WorkflowExecution = {
        _id: "exec-no-snapshot",
        workflowId: "wf-1",
        status: "completed",
        nodeResults: [
          { nodeId: "custom-task-99", status: "completed" },
        ],
      };

      const timeline = buildExecutionTimeline(execution);
      assert.equal(timeline.steps.length, 1);
      assert.equal(timeline.steps[0].nodeId, "custom-task-99");
      assert.equal(timeline.steps[0].label, "custom-task-99");
      assert.equal(timeline.steps[0].nodeType, "task");
    });

    it("honestly marks 'Duration unavailable' when node timestamps are absent", () => {
      const execution: WorkflowExecution = {
        _id: "exec-no-node-timing",
        workflowId: "wf-1",
        status: "completed",
        startedAt: "2026-10-29T10:00:00.000Z",
        completedAt: "2026-10-29T10:00:01.000Z",
        nodeResults: [
          { nodeId: "node-1", status: "completed" },
        ],
      };

      const timeline = buildExecutionTimeline(execution);
      assert.equal(timeline.steps[0].durationText, "Duration unavailable");
      assert.equal(timeline.steps[0].hasValidDuration, false);
      assert.equal(timeline.hasAnyValidNodeDuration, false);
      // Crucial: Must NOT select a misleading slowest node!
      assert.equal(timeline.slowestNode, null);
    });

    it("correctly calculates and identifies the slowest node when valid durations exist", () => {
      const execution: WorkflowExecution = {
        _id: "exec-with-timing",
        workflowId: "wf-timing",
        status: "completed",
        startedAt: "2026-10-29T10:00:00.000Z",
        completedAt: "2026-10-29T10:00:03.000Z",
        nodeResults: [
          {
            nodeId: "node-fast",
            status: "completed",
            startedAt: "2026-10-29T10:00:00.000Z",
            completedAt: "2026-10-29T10:00:00.200Z",
          },
          {
            nodeId: "node-slow",
            status: "completed",
            startedAt: "2026-10-29T10:00:00.200Z",
            completedAt: "2026-10-29T10:00:02.700Z",
          },
          {
            nodeId: "node-medium",
            status: "completed",
            startedAt: "2026-10-29T10:00:02.700Z",
            completedAt: "2026-10-29T10:00:03.000Z",
          },
        ],
      };

      const timeline = buildExecutionTimeline(execution);
      assert.equal(timeline.hasAnyValidNodeDuration, true);
      assert.ok(timeline.slowestNode);
      assert.equal(timeline.slowestNode?.nodeId, "node-slow");
      assert.equal(timeline.slowestNode?.durationText, "2.5 s");
      assert.equal(timeline.steps[1].isSlowest, true);
      assert.equal(timeline.steps[0].isSlowest, false);
      assert.equal(timeline.steps[2].isSlowest, false);
    });

    it("accurately captures failed node details and sanitizes error messages", () => {
      const execution: WorkflowExecution = {
        _id: "exec-failed-node",
        workflowId: "wf-fail",
        status: "failed",
        startedAt: "2026-10-29T10:00:00.000Z",
        completedAt: "2026-10-29T10:00:00.050Z",
        nodeResults: [
          { nodeId: "trigger-1", status: "completed" },
          {
            nodeId: "task-failing",
            status: "failed",
            error: {
              code: "HTTP_ERROR",
              message: "Connection failed at http://secret-api.internal:8080/v1 at Object.run (/app/secret.ts:42)",
            },
          },
        ],
      };

      const timeline = buildExecutionTimeline(execution);
      assert.ok(timeline.failedStep);
      assert.equal(timeline.failedStep?.nodeId, "task-failing");
      assert.equal(timeline.failedStep?.stepNumber, 2);
      assert.ok(timeline.failedStep?.error?.includes("[technical details hidden]"));
      assert.ok(!timeline.failedStep?.error?.includes("secret-api.internal"));
    });

    it("correctly handles skipped nodes and compensation states", () => {
      const execution: WorkflowExecution = {
        _id: "exec-compensation-timeline",
        workflowId: "wf-saga",
        status: "compensated",
        startedAt: "2026-10-29T10:00:00.000Z",
        completedAt: "2026-10-29T10:00:04.000Z",
        nodeResults: [
          {
            nodeId: "task-reserve",
            status: "completed",
            compensation: {
              status: "completed",
              startedAt: "2026-10-29T10:00:02.000Z",
              completedAt: "2026-10-29T10:00:03.500Z",
            },
          },
          {
            nodeId: "task-charge",
            status: "failed",
            error: "Payment declined",
          },
          {
            nodeId: "task-notify",
            status: "skipped",
          },
        ],
      };

      const timeline = buildExecutionTimeline(execution);
      assert.equal(timeline.steps.length, 3);
      assert.equal(timeline.steps[0].compensation?.status, "completed");
      assert.equal(timeline.steps[0].compensation?.durationText, "1.5 s");
      assert.equal(timeline.steps[1].status, "failed");
      assert.equal(timeline.steps[2].status, "skipped");
    });

    it("handles empty or null executions gracefully", () => {
      const empty1 = buildExecutionTimeline(null);
      assert.equal(empty1.steps.length, 0);
      assert.equal(empty1.slowestNode, null);
      assert.equal(empty1.failedStep, null);
      assert.equal(empty1.totalDurationText, "Duration unavailable");

      const empty2 = buildExecutionTimeline({
        _id: "exec-empty-nodes",
        workflowId: "wf-empty",
        status: "queued",
        nodeResults: [],
      });
      assert.equal(empty2.steps.length, 0);
      assert.equal(empty2.slowestNode, null);
      assert.equal(empty2.failedStep, null);
    });
  });
});

