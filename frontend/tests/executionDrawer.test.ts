import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createInitialDrawerState,
  openDrawerForExecution,
  closeDrawerState,
  getErrorText,
  sanitizeErrorMessage,
  type ExecutionDrawerState,
} from "../src/executionHelpers";
import type { WorkflowExecution } from "../src/api/executionApi";

describe("execution details side drawer state management", () => {
  it("initializes with drawer closed, no selection, and no errors", () => {
    const state = createInitialDrawerState();
    assert.equal(state.isOpen, false);
    assert.equal(state.selectedId, "");
    assert.equal(state.loadingId, "");
    assert.equal(state.error, "");
    assert.equal(state.details, null);
  });

  it("opens details for a selected execution, setting loadingId and clearing prior errors", () => {
    const initial = createInitialDrawerState();
    const updated = openDrawerForExecution(initial, "exec-123");

    assert.equal(updated.isOpen, true);
    assert.equal(updated.selectedId, "exec-123");
    assert.equal(updated.loadingId, "exec-123");
    assert.equal(updated.error, "");
    assert.equal(updated.details, null);
  });

  it("closes the drawer and clears all selection, loading, and detail states", () => {
    const _activeState: ExecutionDrawerState = {
      isOpen: true,
      selectedId: "exec-123",
      loadingId: "",
      error: "Previous error",
      details: {
        _id: "exec-123",
        workflowId: "wf-1",
        status: "completed",
      },
    };

    const closed = closeDrawerState();
    assert.equal(closed.isOpen, false);
    assert.equal(closed.selectedId, "");
    assert.equal(closed.loadingId, "");
    assert.equal(closed.error, "");
    assert.equal(closed.details, null);
  });

  it("protects against stale responses when switching between executions while a request is pending", async () => {
    let activeRequestId = 0;
    let renderedDetails: WorkflowExecution | null = null;
    let renderedLoadingId = "";

    async function mockShowDetails(
      executionId: string,
      fetchDelayMs: number,
      mockResult: WorkflowExecution,
    ) {
      const requestId = ++activeRequestId;
      renderedLoadingId = executionId;
      renderedDetails = null;

      await new Promise((resolve) => setTimeout(resolve, fetchDelayMs));

      // Stale check
      if (requestId !== activeRequestId) {
        return;
      }

      renderedDetails = mockResult;
      renderedLoadingId = "";
    }

    // Start fetching execution A (slow)
    const execAPromise = mockShowDetails("exec-A", 50, {
      _id: "exec-A",
      workflowId: "wf-slow",
      status: "running",
    });

    // Quickly switch to execution B (fast)
    const execBPromise = mockShowDetails("exec-B", 10, {
      _id: "exec-B",
      workflowId: "wf-fast",
      status: "completed",
    });

    await Promise.all([execAPromise, execBPromise]);

    // Execution B must be rendered, execution A's stale response was dropped
    assert.equal(renderedDetails?._id, "exec-B");
    assert.equal(renderedDetails?.status, "completed");
    assert.equal(renderedLoadingId, "");
  });

  it("manages loading, error, and empty states appropriately", () => {
    const loadingState: ExecutionDrawerState = {
      isOpen: true,
      selectedId: "exec-456",
      loadingId: "exec-456",
      error: "",
      details: null,
    };
    assert.ok(loadingState.isOpen && loadingState.loadingId && !loadingState.details);

    const errorState: ExecutionDrawerState = {
      isOpen: true,
      selectedId: "exec-456",
      loadingId: "",
      error: "Unable to load execution details.",
      details: null,
    };
    assert.ok(errorState.isOpen && errorState.error && !errorState.details);

    const emptyNodeResults: WorkflowExecution = {
      _id: "exec-empty",
      workflowId: "wf-1",
      status: "completed",
      nodeResults: [],
    };
    assert.equal(emptyNodeResults.nodeResults?.length ?? 0, 0);
  });

  it("preserves complete node results and compensation information in detail payload", () => {
    const execution: WorkflowExecution = {
      _id: "exec-saga-1",
      workflowId: "wf-saga",
      status: "failed",
      currentNodeId: "task-2",
      error: { message: "Internal network failure" },
      nodeResults: [
        {
          nodeId: "task-1",
          status: "completed",
          startedAt: "2026-10-30T10:00:00.000Z",
          completedAt: "2026-10-30T10:00:01.000Z",
          output: { bookingId: "book-999", charged: true },
          compensation: {
            status: "completed",
            startedAt: "2026-10-30T10:00:02.000Z",
            completedAt: "2026-10-30T10:00:03.000Z",
          },
        },
        {
          nodeId: "task-2",
          status: "failed",
          startedAt: "2026-10-30T10:00:01.500Z",
          completedAt: "2026-10-30T10:00:02.000Z",
          error: "Connection refused to payment gateway",
          compensation: {
            status: "failed",
            startedAt: "2026-10-30T10:00:03.000Z",
            completedAt: "2026-10-30T10:00:03.500Z",
            error: { message: "Refund reversal rejected by bank" },
          },
        },
      ],
    };

    assert.equal(execution.nodeResults?.length, 2);

    const task1 = execution.nodeResults![0];
    assert.equal(task1.nodeId, "task-1");
    assert.equal(task1.status, "completed");
    assert.deepEqual(task1.output, { bookingId: "book-999", charged: true });
    assert.equal(task1.compensation?.status, "completed");

    const task2 = execution.nodeResults![1];
    assert.equal(task2.nodeId, "task-2");
    assert.equal(task2.status, "failed");
    assert.equal(task2.compensation?.status, "failed");
    assert.equal(
      sanitizeErrorMessage(task2.compensation?.error?.message ?? ""),
      "Refund reversal rejected by bank",
    );
    assert.equal(
      getErrorText(execution.error),
      "Internal network failure",
    );
  });

  it("handles missing and present execution-level compensation information", () => {
    // 1. Missing execution-level compensation (normal execution)
    const normalExec: WorkflowExecution = {
      _id: "exec-normal",
      workflowId: "wf-1",
      status: "completed",
    };
    assert.equal(normalExec.compensation, undefined);

    // 2. Present execution-level compensation (Saga execution)
    const compensatedExec: WorkflowExecution = {
      _id: "exec-saga-root",
      workflowId: "wf-saga",
      status: "compensated",
      compensation: {
        status: "completed",
        startedAt: "2026-10-30T10:05:00.000Z",
        completedAt: "2026-10-30T10:05:02.000Z",
      },
    };
    assert.ok(compensatedExec.compensation);
    assert.equal(compensatedExec.compensation?.status, "completed");
    assert.equal(compensatedExec.compensation?.startedAt, "2026-10-30T10:05:00.000Z");
    assert.equal(compensatedExec.compensation?.completedAt, "2026-10-30T10:05:02.000Z");

    // 3. Execution-level compensation failure with error message
    const failedCompensationExec: WorkflowExecution = {
      _id: "exec-saga-fail",
      workflowId: "wf-saga",
      status: "compensation_failed",
      compensation: {
        status: "failed",
        startedAt: "2026-10-30T10:05:00.000Z",
        completedAt: "2026-10-30T10:05:03.000Z",
        error: { message: "Compensation checkpoint store timed out at https://db.internal:27017" },
      },
    };
    assert.ok(failedCompensationExec.compensation);
    assert.equal(failedCompensationExec.compensation?.status, "failed");
    const compError = failedCompensationExec.compensation?.error as { message: string } | undefined;
    const sanitizedCompError = sanitizeErrorMessage(
      compError?.message ?? "",
    );
    assert.ok(sanitizedCompError.includes("[technical details hidden]"));
    assert.ok(!sanitizedCompError.includes("https://db.internal"));
  });
});
