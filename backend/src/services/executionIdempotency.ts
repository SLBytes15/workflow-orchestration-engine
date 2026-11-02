import crypto from "node:crypto";
import type { Types } from "mongoose";
import IdempotencyRecordModel from "../models/idempotencyRecord.model";
import WorkflowExecutionModel from "../models/WorkflowExecution";

export interface IdempotencyRecord {
  tenantId: Types.ObjectId | string;
  workflowId: Types.ObjectId | string;
  key: string;
  payloadHash: string;
  executionId?: Types.ObjectId | string | null;
  reservationToken?: string | null;
  status: "in_flight" | "completed";
  responseBody?: any;
  createdAt?: Date;
  updatedAt?: Date;
  expiresAt: Date;
}

export type IdempotencyCheckResult =
  | { status: "new"; executionId?: string; reservationToken?: string }
  | { status: "mismatch" }
  | { status: "in_flight"; executionId: string }
  | { status: "match"; responseBody: any; executionId: string };

export interface ReconciliationOptions {
  now?: Date;
  /**
   * Minimum duration (ms) an in_flight reservation must have existed before
   * treating a missing execution document as "crashed before creation" vs "actively being created".
   * Default: 5000ms.
   */
  creationGracePeriodMs?: number;
}

export type ReconciliationOutcome =
  | {
      action: "RETRY_SAFE";
      reason: string;
      executionId: string;
      reservationToken?: string;
    }
  | {
      action: "PRESERVE_IN_FLIGHT";
      reason: string;
      executionId: string;
      executionStatus: "queued" | "running" | "compensating" | "active_pending_creation";
    }
  | {
      action: "COMPLETED_RECONCILED";
      reason: string;
      executionId: string;
      responseBody: any;
    }
  | {
      action: "UNCERTAIN_RETAIN";
      reason: string;
      executionId?: string;
      error?: string;
    };

export interface IdempotencyDependencies {
  findRecord(
    tenantId: Types.ObjectId | string,
    workflowId: Types.ObjectId | string,
    key: string,
  ): Promise<any>;

  createRecord(record: {
    tenantId: Types.ObjectId | string;
    workflowId: Types.ObjectId | string;
    key: string;
    payloadHash: string;
    status: "in_flight" | "completed";
    executionId?: Types.ObjectId | string | null;
    reservationToken?: string | null;
    responseBody?: any;
    expiresAt: Date;
    createdAt?: Date;
    updatedAt?: Date;
  }): Promise<any>;

  updateRecord(
    filter: Record<string, any>,
    update: Record<string, any>,
  ): Promise<any>;

  deleteRecord(
    tenantId: Types.ObjectId | string,
    workflowId: Types.ObjectId | string,
    key: string,
    filter?: { reservationToken?: string },
  ): Promise<any>;

  findExecution?(
    tenantId: Types.ObjectId | string,
    executionId: Types.ObjectId | string,
  ): Promise<any>;

  findInFlightRecords?(
    tenantId: Types.ObjectId | string,
    filter?: { olderThan?: Date; limit?: number },
  ): Promise<any[]>;
}

export const mongoIdempotencyDependencies: IdempotencyDependencies = {
  findRecord(tenantId, workflowId, key) {
    return IdempotencyRecordModel.findOne({ tenantId, workflowId, key })
      .lean()
      .exec();
  },
  createRecord(record) {
    return IdempotencyRecordModel.create(record);
  },
  updateRecord(filter, update) {
    return IdempotencyRecordModel.findOneAndUpdate(filter, update, {
      returnDocument: "after",
      runValidators: true,
    })
      .lean()
      .exec();
  },
  deleteRecord(tenantId, workflowId, key, filter) {
    const query: Record<string, any> = { tenantId, workflowId, key };
    if (filter?.reservationToken) {
      query.reservationToken = filter.reservationToken;
    }
    return IdempotencyRecordModel.deleteOne(query).exec();
  },
  findExecution(tenantId, executionId) {
    return WorkflowExecutionModel.findOne({ _id: executionId, tenantId })
      .lean()
      .exec();
  },
  findInFlightRecords(tenantId, filter) {
    const query: Record<string, any> = { tenantId, status: "in_flight" };
    if (filter?.olderThan) {
      query.createdAt = { $lte: filter.olderThan };
    }
    const q = IdempotencyRecordModel.find(query).sort({ createdAt: 1 });
    if (filter?.limit) {
      q.limit(filter.limit);
    }
    return q.lean().exec();
  },
};

export function createMemoryIdempotencyDependencies(
  executionsStore: Map<string, any> = new Map(),
): IdempotencyDependencies & {
  executionsStore: Map<string, any>;
  store: Map<string, any>;
} {
  const store = new Map<string, any>();
  const buildKey = (tenantId: any, workflowId: any, key: any) =>
    `${String(tenantId)}:${String(workflowId)}:${String(key)}`;

  return {
    executionsStore,
    store,
    async findRecord(tenantId, workflowId, key) {
      const record = store.get(buildKey(tenantId, workflowId, key));
      return record ? { ...record } : null;
    },
    async createRecord(record) {
      const composite = buildKey(record.tenantId, record.workflowId, record.key);
      if (store.has(composite)) {
        const error: any = new Error("E11000 duplicate key error");
        error.code = 11000;
        throw error;
      }
      const entry = {
        ...record,
        executionId: record.executionId ? stringifyId(record.executionId) : null,
        createdAt: record.createdAt ?? new Date(),
        updatedAt: record.updatedAt ?? new Date(),
      };
      store.set(composite, entry);
      return entry;
    },
    async updateRecord(filter, update) {
      const composite = buildKey(filter.tenantId, filter.workflowId, filter.key);
      const existing = store.get(composite);
      if (!existing) return null;

      if (filter.status && existing.status !== filter.status) {
        return null;
      }

      if (filter.executionId && stringifyId(existing.executionId) !== stringifyId(filter.executionId)) {
        return null;
      }

      if (filter.reservationToken && existing.reservationToken !== filter.reservationToken) {
        return null;
      }

      const expiresAtFilter = filter.expiresAt as { $lte?: Date } | undefined;
      if (expiresAtFilter?.$lte) {
        if (new Date(existing.expiresAt).getTime() > new Date(expiresAtFilter.$lte).getTime()) {
          return null;
        }
      }

      if (filter.updatedAt) {
        const existingUpdated = new Date(existing.updatedAt).getTime();
        const expectedUpdated = new Date(filter.updatedAt).getTime();
        if (existingUpdated !== expectedUpdated) {
          return null;
        }
      }

      const setUpdates = (update.$set as Record<string, any>) || {};
      const updated = {
        ...existing,
        ...setUpdates,
        updatedAt: setUpdates.updatedAt ?? new Date(),
      };
      if (updated.executionId) {
        updated.executionId = stringifyId(updated.executionId);
      }
      store.set(composite, updated);
      return updated;
    },
    async deleteRecord(tenantId, workflowId, key, filter) {
      const composite = buildKey(tenantId, workflowId, key);
      const existing = store.get(composite);
      if (!existing) return { deletedCount: 0 };
      if (filter?.reservationToken && existing.reservationToken !== filter.reservationToken) {
        return { deletedCount: 0 };
      }
      const existed = store.delete(composite);
      return { deletedCount: existed ? 1 : 0 };
    },
    async findExecution(tenantId, executionId) {
      const composite = `${String(tenantId)}:${String(executionId)}`;
      const execution = executionsStore.get(composite) ?? executionsStore.get(String(executionId));
      if (!execution) return null;
      // Enforce strict tenant isolation on execution lookup
      if (execution.tenantId && String(execution.tenantId) !== String(tenantId)) {
        return null;
      }
      const cloned = structuredClone(execution);
      if (execution._id) {
        cloned._id = stringifyId(execution._id);
      }
      return cloned;
    },
    async findInFlightRecords(tenantId, filter) {
      const results: any[] = [];
      for (const record of store.values()) {
        if (String(record.tenantId) === String(tenantId) && record.status === "in_flight") {
          if (filter?.olderThan) {
            if (new Date(record.createdAt).getTime() <= new Date(filter.olderThan).getTime()) {
              results.push({ ...record });
            }
          } else {
            results.push({ ...record });
          }
        }
      }
      results.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return filter?.limit ? results.slice(0, filter.limit) : results;
    },
  };
}

/**
 * Computes deterministic SHA-256 hash of a JSON payload with sorted keys.
 */
export function computePayloadHash(payload: unknown): string {
  const canonical = canonicalJsonStringify(payload ?? {});
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJsonStringify).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) => JSON.stringify(k) + ":" + canonicalJsonStringify((obj as any)[k]),
  );
  return "{" + entries.join(",") + "}";
}

function stringifyId(id: unknown): string {
  if (id === null || id === undefined) return "";
  if (typeof id === "string") return id;
  if (typeof (id as any).toHexString === "function") return (id as any).toHexString();
  if (typeof (id as any).toString === "function" && (id as any).toString() !== "[object Object]") {
    return (id as any).toString();
  }
  return String(id);
}

/**
 * Durable, MongoDB-backed Idempotency Service for workflow execution requests.
 * Protects against duplicate execution across concurrent requests, server restarts,
 * and multiple backend instances sharing the same database.
 */
export class IdempotencyService {
  private readonly dependencies: IdempotencyDependencies;
  private readonly ttlMs: number;

  constructor(
    dependencies: IdempotencyDependencies = mongoIdempotencyDependencies,
    ttlMs = 24 * 60 * 60 * 1000,
  ) {
    this.dependencies = dependencies;
    this.ttlMs = ttlMs;
  }

  public async reserveKey(
    tenantId: Types.ObjectId | string,
    workflowId: Types.ObjectId | string,
    key: string,
    payloadHash: string,
    options: { now?: Date; ttlMs?: number; executionId?: any; creationGracePeriodMs?: number } = {},
  ): Promise<IdempotencyCheckResult> {
    const now = options.now ?? new Date();
    const ttlMs = options.ttlMs ?? this.ttlMs;
    const expiresAt = new Date(now.getTime() + ttlMs);

    // 1. Check existing record
    const existing = await this.dependencies.findRecord(tenantId, workflowId, key);
    if (existing) {
      const isExpired = new Date(existing.expiresAt).getTime() <= now.getTime();
      if (!isExpired) {
        if (existing.payloadHash !== payloadHash) {
          return { status: "mismatch" };
        }
        if (existing.status === "in_flight") {
          const outcome = await this.reconcileInFlightReservation(
            tenantId,
            workflowId,
            key,
            existing,
            { now, creationGracePeriodMs: options.creationGracePeriodMs },
          );

          if (outcome.action === "COMPLETED_RECONCILED") {
            return {
              status: "match",
              executionId: outcome.executionId,
              responseBody: outcome.responseBody,
            };
          }

          if (outcome.action === "RETRY_SAFE") {
            return {
              status: "new",
              executionId: outcome.executionId,
              reservationToken: outcome.reservationToken,
            };
          }

          return {
            status: "in_flight",
            executionId: outcome.executionId || stringifyId(existing.executionId) || "pending",
          };
        }
        return {
          status: "match",
          executionId: stringifyId(existing.executionId),
          responseBody: existing.responseBody,
        };
      }

      // Record is expired. Replace atomically with fresh reservationToken:
      const reservationToken = crypto.randomUUID();
      const replaced = await this.dependencies.updateRecord(
        {
          tenantId,
          workflowId,
          key,
          expiresAt: { $lte: now },
        },
        {
          $set: {
            payloadHash,
            status: "in_flight",
            executionId: options.executionId ?? null,
            reservationToken,
            responseBody: null,
            expiresAt,
            updatedAt: now,
          },
        },
      );
      if (replaced) {
        return {
          status: "new",
          executionId: options.executionId ? stringifyId(options.executionId) : undefined,
          reservationToken,
        };
      }
      // If atomic replacement failed (competing worker updated), re-check in next step
    }

    // 2. Insert new in-flight reservation with unique reservationToken
    const reservationToken = crypto.randomUUID();
    try {
      await this.dependencies.createRecord({
        tenantId,
        workflowId,
        key,
        payloadHash,
        status: "in_flight",
        executionId: options.executionId ?? null,
        reservationToken,
        responseBody: null,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });

      return {
        status: "new",
        executionId: options.executionId ? stringifyId(options.executionId) : undefined,
        reservationToken,
      };
    } catch (error: any) {
      // Duplicate key race (code 11000 from unique compound index on tenantId + workflowId + key)
      if (
        error?.code === 11000 ||
        error?.name === "MongoServerError" ||
        String(error?.message).includes("E11000")
      ) {
        const winner = await this.dependencies.findRecord(tenantId, workflowId, key);
        if (winner) {
          const isExpired = new Date(winner.expiresAt).getTime() <= now.getTime();
          if (!isExpired) {
            if (winner.payloadHash !== payloadHash) {
              return { status: "mismatch" };
            }
            if (winner.status === "in_flight") {
              const outcome = await this.reconcileInFlightReservation(
                tenantId,
                workflowId,
                key,
                winner,
                { now, creationGracePeriodMs: options.creationGracePeriodMs },
              );

              if (outcome.action === "COMPLETED_RECONCILED") {
                return {
                  status: "match",
                  executionId: outcome.executionId,
                  responseBody: outcome.responseBody,
                };
              }

              if (outcome.action === "RETRY_SAFE") {
                return {
                  status: "new",
                  executionId: outcome.executionId,
                  reservationToken: outcome.reservationToken,
                };
              }

              return {
                status: "in_flight",
                executionId: outcome.executionId || stringifyId(winner.executionId) || "pending",
              };
            }
            return {
              status: "match",
              executionId: stringifyId(winner.executionId),
              responseBody: winner.responseBody,
            };
          }
        }
      }
      throw error;
    }
  }

  public async reconcileInFlightReservation(
    tenantId: Types.ObjectId | string,
    workflowId: Types.ObjectId | string,
    key: string,
    record?: any,
    options: ReconciliationOptions = {},
  ): Promise<ReconciliationOutcome> {
    const now = options.now ?? new Date();
    const creationGracePeriodMs = options.creationGracePeriodMs ?? 5000;

    let targetRecord = record;
    if (!targetRecord) {
      try {
        targetRecord = await this.dependencies.findRecord(tenantId, workflowId, key);
      } catch (err: any) {
        return {
          action: "UNCERTAIN_RETAIN",
          reason: `Failed to fetch idempotency record: ${err?.message ?? "unknown error"}`,
          error: err?.message,
        };
      }
    }

    if (!targetRecord) {
      return {
        action: "UNCERTAIN_RETAIN",
        reason: "Idempotency record does not exist.",
      };
    }

    if (targetRecord.status !== "in_flight") {
      return {
        action: "COMPLETED_RECONCILED",
        reason: `Record is already in status '${targetRecord.status}'.`,
        executionId: stringifyId(targetRecord.executionId),
        responseBody: targetRecord.responseBody,
      };
    }

    const executionIdStr = stringifyId(targetRecord.executionId);
    if (!executionIdStr) {
      return {
        action: "UNCERTAIN_RETAIN",
        reason: "In-flight record has no pre-allocated executionId.",
      };
    }

    if (!this.dependencies.findExecution) {
      return {
        action: "UNCERTAIN_RETAIN",
        reason: "Execution lookup dependency (findExecution) is not configured.",
        executionId: executionIdStr,
      };
    }

    let execution: any;
    try {
      execution = await this.dependencies.findExecution(tenantId, executionIdStr);
    } catch (err: any) {
      return {
        action: "UNCERTAIN_RETAIN",
        reason: `Execution lookup failed or database unavailable: ${err?.message ?? "unknown error"}`,
        executionId: executionIdStr,
        error: err?.message,
      };
    }

    // 1. Execution document does NOT exist
    if (!execution) {
      const recordCreatedTime = new Date(targetRecord.createdAt ?? targetRecord.updatedAt ?? now).getTime();
      const ageMs = Math.max(0, now.getTime() - recordCreatedTime);

      if (ageMs < creationGracePeriodMs) {
        return {
          action: "PRESERVE_IN_FLIGHT",
          reason: `Reservation is ${ageMs}ms old, within creation grace period (${creationGracePeriodMs}ms). Execution may be actively being created.`,
          executionId: executionIdStr,
          executionStatus: "active_pending_creation",
        };
      }

      // Safe to retry: worker crashed before creating the execution document.
      // Zero actions or external side-effects occurred.
      // Invalidate previous owner's authority by generating a fresh reservationToken!
      const newReservationToken = crypto.randomUUID();
      const updated = await this.dependencies.updateRecord(
        {
          tenantId,
          workflowId,
          key,
          status: "in_flight",
          executionId: targetRecord.executionId,
          ...(targetRecord.reservationToken ? { reservationToken: targetRecord.reservationToken } : {}),
          ...(targetRecord.updatedAt ? { updatedAt: targetRecord.updatedAt } : {}),
        },
        {
          $set: {
            reservationToken: newReservationToken,
            updatedAt: now,
          },
        },
      );

      if (!updated) {
        return {
          action: "UNCERTAIN_RETAIN",
          reason: "Concurrent modification detected during in-flight reservation retry claim.",
          executionId: executionIdStr,
        };
      }

      return {
        action: "RETRY_SAFE",
        reason: "No execution document was created before crash; zero actions executed. Safe to retry with pre-allocated execution ID.",
        executionId: executionIdStr,
        reservationToken: newReservationToken,
      };
    }

    // 2. Execution is queued or running
    if (execution.status === "queued" || execution.status === "running") {
      return {
        action: "PRESERVE_IN_FLIGHT",
        reason: `Execution is currently '${execution.status}'.`,
        executionId: executionIdStr,
        executionStatus: execution.status,
      };
    }

    // 3. Execution is compensating
    if (execution.status === "compensating") {
      return {
        action: "PRESERVE_IN_FLIGHT",
        reason: "Execution is currently compensating; duplicate dispatch blocked.",
        executionId: executionIdStr,
        executionStatus: "compensating",
      };
    }

    // 4. Execution is in terminal state (completed, failed, compensated, compensation_failed)
    const isCompleted = execution.status === "completed";
    const responseBody = {
      message: isCompleted
        ? "Workflow execution completed"
        : "Workflow execution failed",
      execution: {
        id: String(execution._id),
        workflowId: String(execution.workflowId),
        workflowVersion: execution.workflowVersion,
        status: execution.status,
        currentNodeId: execution.currentNodeId ?? null,
        nodeResults: execution.nodeResults ?? [],
        error: execution.error ?? null,
        startedAt: execution.startedAt ?? null,
        completedAt: execution.completedAt ?? null,
        createdAt: execution.createdAt,
      },
    };

    // Atomically persist terminal responseBody into IdempotencyRecord
    await this.dependencies.updateRecord(
      {
        tenantId,
        workflowId,
        key,
        status: "in_flight",
      },
      {
        $set: {
          status: "completed",
          responseBody,
          executionId: executionIdStr,
          updatedAt: now,
        },
      },
    );

    return {
      action: "COMPLETED_RECONCILED",
      reason: `Execution reached terminal status '${execution.status}'. Reconstructed and persisted cached response.`,
      executionId: executionIdStr,
      responseBody,
    };
  }

  public async validateOwnership(
    tenantId: Types.ObjectId | string,
    workflowId: Types.ObjectId | string,
    key: string,
    reservationToken: string,
  ): Promise<boolean> {
    const record = await this.dependencies.findRecord(tenantId, workflowId, key);
    if (!record || record.status !== "in_flight") return false;
    return record.reservationToken === reservationToken;
  }

  public async recordCompleted(
    tenantId: Types.ObjectId | string,
    workflowId: Types.ObjectId | string,
    key: string,
    payloadHash: string,
    executionId: Types.ObjectId | string,
    responseBody: any,
    options: { now?: Date; ttlMs?: number; reservationToken?: string } = {},
  ): Promise<void> {
    const now = options.now ?? new Date();
    const ttlMs = options.ttlMs ?? this.ttlMs;
    const expiresAt = new Date(now.getTime() + ttlMs);

    const filter: Record<string, any> = { tenantId, workflowId, key };
    if (options.reservationToken) {
      filter.reservationToken = options.reservationToken;
    }

    await this.dependencies.updateRecord(
      filter,
      {
        $set: {
          status: "completed",
          executionId,
          responseBody,
          payloadHash,
          expiresAt,
        },
      },
    );
  }

  public async clearKey(
    tenantId: Types.ObjectId | string,
    workflowId: Types.ObjectId | string,
    key: string,
    reservationToken?: string,
  ): Promise<boolean> {
    const res = await this.dependencies.deleteRecord(
      tenantId,
      workflowId,
      key,
      reservationToken ? { reservationToken } : undefined,
    );
    return Boolean(res?.deletedCount);
  }

  public async checkIdempotency(
    tenantId: Types.ObjectId | string,
    workflowId: Types.ObjectId | string,
    key: string,
    payloadHash: string,
    options: { now?: Date; creationGracePeriodMs?: number } = {},
  ): Promise<IdempotencyCheckResult> {
    const now = options.now ?? new Date();
    const record = await this.dependencies.findRecord(tenantId, workflowId, key);

    if (!record) {
      return { status: "new" };
    }

    if (new Date(record.expiresAt).getTime() <= now.getTime()) {
      return { status: "new" };
    }

    if (record.payloadHash !== payloadHash) {
      return { status: "mismatch" };
    }

    if (record.status === "in_flight") {
      const outcome = await this.reconcileInFlightReservation(
        tenantId,
        workflowId,
        key,
        record,
        { now, creationGracePeriodMs: options.creationGracePeriodMs },
      );

      if (outcome.action === "COMPLETED_RECONCILED") {
        return {
          status: "match",
          executionId: outcome.executionId,
          responseBody: outcome.responseBody,
        };
      }

      if (outcome.action === "RETRY_SAFE") {
        return {
          status: "new",
          executionId: outcome.executionId,
        };
      }

      return {
        status: "in_flight",
        executionId: outcome.executionId || stringifyId(record.executionId) || "pending",
      };
    }

    return {
      status: "match",
      executionId: stringifyId(record.executionId),
      responseBody: record.responseBody,
    };
  }
}

export interface IdempotencyRecoveryWorkerOptions {
  intervalMs?: number;
  creationGracePeriodMs?: number;
  batchSize?: number;
  now?: () => Date;
}

/**
 * Tenant-scoped Recovery Worker that scans for stale in_flight idempotency records
 * and reconciles them against actual WorkflowExecution states.
 * Uses atomic CAS updates to claim items and prevent overlapping runs.
 */
export class IdempotencyRecoveryWorker {
  private readonly dependencies: IdempotencyDependencies;
  private readonly tenantId: Types.ObjectId | string;
  private readonly intervalMs: number;
  private readonly creationGracePeriodMs: number;
  private readonly batchSize: number;
  private readonly nowFn: () => Date;
  private timer: NodeJS.Timeout | null = null;
  private isReconciling = false;
  private isRunning = false;

  constructor(
    tenantId: Types.ObjectId | string,
    dependencies: IdempotencyDependencies = mongoIdempotencyDependencies,
    options: IdempotencyRecoveryWorkerOptions = {},
  ) {
    this.tenantId = tenantId;
    this.dependencies = dependencies;
    this.intervalMs = options.intervalMs ?? 30000;
    this.creationGracePeriodMs = options.creationGracePeriodMs ?? 10000;
    this.batchSize = options.batchSize ?? 50;
    this.nowFn = options.now ?? (() => new Date());
  }

  public get running(): boolean {
    return this.isRunning;
  }

  public get reconciling(): boolean {
    return this.isReconciling;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.runOnce().catch(() => {});
    }, this.intervalMs);
    if (this.timer && typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    while (this.isReconciling) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  public async runOnce(): Promise<{ reconciledCount: number; checkedCount: number }> {
    if (this.isReconciling) {
      return { reconciledCount: 0, checkedCount: 0 };
    }
    this.isReconciling = true;
    try {
      if (!this.dependencies.findInFlightRecords) {
        return { reconciledCount: 0, checkedCount: 0 };
      }

      const now = this.nowFn();
      const cutoff = new Date(now.getTime() - this.creationGracePeriodMs);
      const staleRecords = await this.dependencies.findInFlightRecords(this.tenantId, {
        olderThan: cutoff,
        limit: this.batchSize,
      });

      let reconciledCount = 0;
      const idempotencyService = new IdempotencyService(this.dependencies);

      for (const record of staleRecords) {
        const outcome = await idempotencyService.reconcileInFlightReservation(
          record.tenantId,
          record.workflowId,
          record.key,
          record,
          { now, creationGracePeriodMs: this.creationGracePeriodMs },
        );

        if (outcome.action === "COMPLETED_RECONCILED" || outcome.action === "RETRY_SAFE") {
          reconciledCount++;
        }
      }

      return { reconciledCount, checkedCount: staleRecords.length };
    } finally {
      this.isReconciling = false;
    }
  }
}

export const defaultIdempotencyService = new IdempotencyService();
