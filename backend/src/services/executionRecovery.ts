import type { Types } from "mongoose";
import type {
  ExecutionServiceDependencies,
} from "./execution.service";
import { buildExecutionUpdateFilter } from "./execution.service";
import type { RuntimeNodeResult } from "./execution.runtime";

export type RecoveryOutcome =
  | "SAFE_TO_RESUME"
  | "SAFE_TO_MARK_FAILED"
  | "SAFE_TO_CONTINUE_COMPENSATION"
  | "REQUIRES_MANUAL_INTERVENTION";

export interface RecoveryEvaluationOptions {
  now?: Date;
  /** Maximum assumed duration for a single task node before timeout suspected (default 5m / 300,000ms) */
  defaultTaskTimeoutMs?: number;
  /** Heartbeat/grace period added to timeout before declaring dead (default 1m / 60,000ms) */
  gracePeriodMs?: number;
  /** Maximum queued time before declaring queued execution abandoned (default 10m / 600,000ms) */
  maxQueuedDurationMs?: number;
}

export interface ExecutionRecoveryAnalysis {
  outcome: RecoveryOutcome;
  isStale: boolean;
  reason: string;
  suggestedTerminalStatus?: "failed" | "compensation_failed" | "compensated";
  suggestedError?: { code: string; message: string };
  uncompensatedNodeIds?: string[];
  inFlightNodeId?: string | null;
}

const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_GRACE_PERIOD_MS = 60 * 1000; // 1 minute
const DEFAULT_MAX_QUEUED_DURATION_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Pure evaluation function that inspects a persisted WorkflowExecution snapshot
 * and determines safe recovery options according to distributed systems and idempotency constraints.
 */
export function evaluateExecutionRecovery(
  execution: {
    status: string;
    createdAt?: Date | string | null;
    startedAt?: Date | string | null;
    updatedAt?: Date | string | null;
    completedAt?: Date | string | null;
    nodeResults?: RuntimeNodeResult[] | null;
    graphSnapshot?: any;
    error?: any;
  },
  options: RecoveryEvaluationOptions = {},
): ExecutionRecoveryAnalysis {
  const now = options.now ?? new Date();
  const defaultTaskTimeoutMs =
    options.defaultTaskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
  const gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
  const maxQueuedDurationMs =
    options.maxQueuedDurationMs ?? DEFAULT_MAX_QUEUED_DURATION_MS;

  const status = execution.status;

  // 1. Terminal states cannot be recovered; they are already complete.
  if (
    status === "completed" ||
    status === "failed" ||
    status === "compensated" ||
    status === "compensation_failed"
  ) {
    return {
      outcome: "SAFE_TO_MARK_FAILED",
      isStale: false,
      reason: `Execution is already in a terminal state (${status}).`,
    };
  }

  // 2. Queued executions
  if (status === "queued") {
    const createdTime = execution.createdAt
      ? new Date(execution.createdAt).getTime()
      : now.getTime();
    const queuedAgeMs = now.getTime() - createdTime;

    if (queuedAgeMs > maxQueuedDurationMs) {
      return {
        outcome: "SAFE_TO_MARK_FAILED",
        isStale: true,
        reason: `Execution remained queued for ${Math.round(
          queuedAgeMs / 1000,
        )}s exceeding maximum allowable queued duration (${Math.round(
          maxQueuedDurationMs / 1000,
        )}s).`,
        suggestedTerminalStatus: "failed",
        suggestedError: {
          code: "QUEUED_EXECUTION_TIMED_OUT",
          message:
            "Execution was never dispatched by a worker within the allowable queue window.",
        },
      };
    }

    return {
      outcome: "SAFE_TO_RESUME",
      isStale: false,
      reason: "Execution is queued and within allowable queue dispatch window.",
    };
  }

  // Calculate last known activity timestamp
  const lastActiveTime = new Date(
    execution.updatedAt ?? execution.startedAt ?? execution.createdAt ?? now,
  ).getTime();
  const elapsedSinceActivityMs = Math.max(0, now.getTime() - lastActiveTime);

  // Determine graph-defined max timeout if available
  let maxConfiguredTimeoutMs = defaultTaskTimeoutMs;
  if (execution.graphSnapshot?.nodes && Array.isArray(execution.graphSnapshot.nodes)) {
    for (const node of execution.graphSnapshot.nodes) {
      const timeout = node?.data?.config?.timeoutMs;
      if (typeof timeout === "number" && timeout > maxConfiguredTimeoutMs) {
        maxConfiguredTimeoutMs = timeout;
      }
    }
  }

  const allowableThresholdMs = maxConfiguredTimeoutMs + gracePeriodMs;

  // 3. Running executions
  if (status === "running") {
    if (elapsedSinceActivityMs < allowableThresholdMs) {
      return {
        outcome: "REQUIRES_MANUAL_INTERVENTION",
        isStale: false,
        reason: `Execution has been active for ${Math.round(
          elapsedSinceActivityMs / 1000,
        )}s which is within the allowable task timeout plus grace period (${Math.round(
          allowableThresholdMs / 1000,
        )}s). It may still be executing safely.`,
      };
    }

    // Execution has exceeded timeout + grace: abandoned or worker crashed.
    const nodeResults = execution.nodeResults ?? [];
    const checkpointCount = nodeResults.length;
    const lastNodeId =
      checkpointCount > 0 ? nodeResults[checkpointCount - 1].nodeId : null;

    if (checkpointCount > 0) {
      return {
        outcome: "SAFE_TO_MARK_FAILED",
        isStale: true,
        inFlightNodeId: lastNodeId,
        reason: `Execution has been running without activity for ${Math.round(
          elapsedSinceActivityMs / 1000,
        )}s, exceeding the allowable threshold (${Math.round(
          allowableThresholdMs / 1000,
        )}s). It has ${checkpointCount} completed forward checkpoint(s) up to '${lastNodeId}'. Re-executing from start would repeat completed actions; automatic restart rejected.`,
        suggestedTerminalStatus: "failed",
        suggestedError: {
          code: "EXECUTION_ABANDONED_WITH_CHECKPOINTS",
          message: `The execution process stopped after checkpointing ${checkpointCount} node(s) up to '${lastNodeId}'. To prevent duplicate side-effects, automatic restart was rejected.`,
        },
      };
    }

    return {
      outcome: "SAFE_TO_MARK_FAILED",
      isStale: true,
      reason: `Execution has been running without activity for ${Math.round(
        elapsedSinceActivityMs / 1000,
      )}s, exceeding the allowable threshold (${Math.round(
        allowableThresholdMs / 1000,
      )}s). Forward progress has no checkpoints; automatic re-dispatch is unsafe.`,
      suggestedTerminalStatus: "failed",
      suggestedError: {
        code: "EXECUTION_ABANDONED_OR_CRASHED",
        message:
          "The execution process stopped or timed out before completing. To prevent duplicate side-effects, automatic restart was rejected.",
      },
    };
  }

  // 4. Compensating executions
  if (status === "compensating") {
    const nodeResults = execution.nodeResults ?? [];

    // Check if any node is currently in running compensation status
    const inFlightNode = nodeResults.find(
      (n) => n.compensation?.status === "running",
    );

    if (inFlightNode) {
      // If a compensation action was mid-flight during crash, external side effect is unknown.
      return {
        outcome: "REQUIRES_MANUAL_INTERVENTION",
        isStale: elapsedSinceActivityMs >= allowableThresholdMs,
        inFlightNodeId: inFlightNode.nodeId,
        reason: `Compensation for node '${inFlightNode.nodeId}' was in 'running' status when execution halted. An external compensation action may have partially executed; automatic retry risks duplicate compensation.`,
      };
    }

    // Check for completed nodes eligible for compensation that have not run yet
    const uncompensatedNodes = nodeResults.filter((n) => {
      if (n.status !== "completed") return false;
      const compStatus = n.compensation?.status;
      return compStatus === "pending" || compStatus === undefined;
    });

    if (uncompensatedNodes.length > 0) {
      const nodeIds = uncompensatedNodes.map((n) => n.nodeId);
      return {
        outcome: "SAFE_TO_CONTINUE_COMPENSATION",
        isStale: elapsedSinceActivityMs >= allowableThresholdMs,
        uncompensatedNodeIds: nodeIds,
        reason: `${uncompensatedNodes.length} eligible completed task(s) have pending compensation checkpoints that were never executed.`,
      };
    }

    // All compensation checkpoints settled (completed or failed), but terminal execution status wasn't written!
    const hasCompensationFailures = nodeResults.some(
      (n) => n.compensation?.status === "failed",
    );
    const suggestedTerminalStatus = hasCompensationFailures
      ? "compensation_failed"
      : "compensated";

    return {
      outcome: "SAFE_TO_MARK_FAILED",
      isStale: true,
      suggestedTerminalStatus,
      suggestedError: execution.error ?? {
        code: "COMPENSATION_TERMINAL_WRITE_RECOVERED",
        message:
          "All node compensation checkpoints were completed prior to crash; terminal status finalized by recovery supervisor.",
      },
      reason: `All node compensations finished (${suggestedTerminalStatus}), but the terminal execution update failed or was interrupted by a crash.`,
    };
  }

  return {
    outcome: "REQUIRES_MANUAL_INTERVENTION",
    isStale: false,
    reason: `Unknown or unhandled execution status: '${status}'.`,
  };
}

/**
 * Safely marks an abandoned or crashed execution as terminal using CAS update.
 * Guarantees that if another worker or concurrent process altered the record in the meantime,
 * the write fails cleanly without dirty overwrites.
 */
export async function recoverAbandonedExecution(
  dependencies: ExecutionServiceDependencies,
  tenantId: Types.ObjectId,
  executionId: Types.ObjectId,
  analysis: ExecutionRecoveryAnalysis,
  expectedStatus: "running" | "queued" | "compensating",
  expectedNodeResults?: RuntimeNodeResult[],
): Promise<any> {
  if (
    analysis.outcome !== "SAFE_TO_MARK_FAILED" ||
    !analysis.suggestedTerminalStatus
  ) {
    throw new Error(
      `Cannot automatically terminate execution: analysis outcome is '${analysis.outcome}' (${analysis.reason}).`,
    );
  }

  const update = {
    status: analysis.suggestedTerminalStatus,
    error: analysis.suggestedError ?? null,
    completedAt: new Date(),
  };

  const updated = await dependencies.updateExecution(
    tenantId,
    executionId,
    expectedStatus,
    expectedNodeResults,
    update,
  );

  return updated;
}

