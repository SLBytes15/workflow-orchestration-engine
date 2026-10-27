import { EventEmitter } from "node:events";
import { Types } from "mongoose";
import BusinessEventModel from "../models/businessEvent.model";
import WorkflowModel from "../models/workflow.model";
import {
  APPROVED_EVENT_SOURCE,
  buildExecutionEventEnvelope,
  matchEventFilter,
  validateBusinessEventDocument,
  type BusinessEventDocument,
} from "../validators/event-contract.validator";
import { createExecutionService } from "./execution.service";

export interface ChangeStreamLike {
  on(event: "change", listener: (change: any) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: () => void): this;
  close(): Promise<void> | void;
  removeAllListeners?(event?: string): this;
}

export interface ActiveWorkflowRecord {
  _id: Types.ObjectId | string;
  tenantId: Types.ObjectId;
  status: "draft" | "active" | "paused";
  graph: {
    nodes?: Array<{
      type: string;
      data?: {
        config?: Record<string, unknown>;
      };
    }>;
  };
}

export interface WatcherLogger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

export interface ChangeStreamWatcherDependencies {
  createChangeStream?: () => ChangeStreamLike | Promise<ChangeStreamLike>;
  findActiveWorkflowsByTenant?: (
    tenantId: Types.ObjectId,
  ) => Promise<ActiveWorkflowRecord[]>;
  startExecution?: (
    tenantId: Types.ObjectId,
    workflowId: string,
    input: Record<string, unknown>,
  ) => Promise<any>;
  logger?: WatcherLogger;
}

const defaultLogger: WatcherLogger = {
  info: (msg, ...args) => console.log(`[WATCHER INFO] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[WATCHER WARN] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[WATCHER ERROR] ${msg}`, ...args),
};

const defaultDependencies: ChangeStreamWatcherDependencies = {
  createChangeStream: () => {
    return BusinessEventModel.watch(
      [{ $match: { operationType: "insert" } }],
      { fullDocument: "updateLookup" },
    ) as unknown as ChangeStreamLike;
  },
  findActiveWorkflowsByTenant: async (tenantId) => {
    return WorkflowModel.find({ tenantId, status: "active" })
      .lean()
      .exec() as unknown as ActiveWorkflowRecord[];
  },
  startExecution: async (tenantId, workflowId, input) => {
    const executionService = createExecutionService();
    return executionService.startExecution(tenantId, workflowId, input);
  },
  logger: defaultLogger,
};

export function createChangeStreamWatcherService(
  dependencies: ChangeStreamWatcherDependencies = defaultDependencies,
) {
  const logger = dependencies.logger ?? defaultLogger;
  let stream: ChangeStreamLike | null = null;
  let isRunning = false;
  let isStopping = false;

  // Promise chain ensuring strict sequential processing of events
  let processingQueue: Promise<void> = Promise.resolve();

  async function handleInsertEvent(
    change: Record<string, unknown>,
  ): Promise<void> {
    if (change.operationType !== "insert") {
      return;
    }

    const validation = validateBusinessEventDocument(change.fullDocument);
    if (!validation.valid || !validation.event) {
      logger.warn(
        `Ignoring invalid business event document: ${validation.errors.join("; ")}`,
      );
      return;
    }

    const event: BusinessEventDocument = validation.event;
    const tenantId = event.tenantId;

    if (!dependencies.findActiveWorkflowsByTenant) {
      logger.error("findActiveWorkflowsByTenant dependency is not configured");
      return;
    }

    let activeWorkflows: ActiveWorkflowRecord[] = [];
    try {
      activeWorkflows = await dependencies.findActiveWorkflowsByTenant(tenantId);
    } catch (queryError) {
      logger.error(
        "Failed to query active workflows for event tenant:",
        queryError instanceof Error ? queryError.message : String(queryError),
      );
      return;
    }

    for (const workflow of activeWorkflows) {
      // Enforce strict tenant isolation: verify workflow belongs to event tenant
      const workflowTenantMatches =
        workflow.tenantId instanceof Types.ObjectId
          ? workflow.tenantId.equals(tenantId)
          : String(workflow.tenantId) === tenantId.toString();

      if (!workflowTenantMatches) {
        logger.warn(
          `Tenant isolation violation prevented: workflow ${workflow._id} tenant does not match event tenant`,
        );
        continue;
      }

      // Only active workflows can be triggered
      if (workflow.status !== "active") {
        continue;
      }

      const triggerNode = workflow.graph?.nodes?.find(
        (node) => node.type === "trigger",
      );
      if (!triggerNode || !triggerNode.data?.config) {
        continue;
      }

      const config = triggerNode.data.config;
      if (
        config.kind !== "event" ||
        config.source !== APPROVED_EVENT_SOURCE ||
        config.eventName !== event.eventName
      ) {
        continue;
      }

      const filterMatches = matchEventFilter(
        config.filter as Record<string, unknown> | undefined,
        event,
      );
      if (!filterMatches) {
        continue;
      }

      // Build execution envelope and dispatch
      const envelope = buildExecutionEventEnvelope(event);
      try {
        if (!dependencies.startExecution) {
          throw new Error("startExecution dependency is not configured");
        }
        await dependencies.startExecution(
          tenantId,
          String(workflow._id),
          envelope as unknown as Record<string, unknown>,
        );
      } catch (dispatchError) {
        // Individual workflow dispatch failure must not terminate the watcher or block subsequent dispatches
        logger.error(
          `Failed to dispatch workflow ${workflow._id} for event ${event._id}: ${
            dispatchError instanceof Error
              ? dispatchError.message
              : String(dispatchError)
          }`,
        );
      }
    }
  }

  function enqueueChange(change: Record<string, unknown>): void {
    if (!isRunning || isStopping) {
      return;
    }

    processingQueue = processingQueue
      .then(async () => {
        await handleInsertEvent(change);
      })
      .catch((error) => {
        logger.error(
          `Unexpected error during sequential event processing: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  return {
    async start(): Promise<void> {
      if (isRunning) {
        return;
      }

      if (!dependencies.createChangeStream) {
        throw new Error("Change stream factory is not configured");
      }

      try {
        const streamInstance = await dependencies.createChangeStream();
        stream = streamInstance;
        isRunning = true;
        isStopping = false;

        stream.on("change", (change: Record<string, unknown>) => {
          enqueueChange(change);
        });

        stream.on("error", (error: Error) => {
          logger.error(
            `Change stream encountered an error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });

        stream.on("close", () => {
          logger.info("Change stream closed");
        });
      } catch (error) {
        isRunning = false;
        logger.error(
          `Failed to initialize change stream watcher: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw error;
      }
    },

    async stop(): Promise<void> {
      if (!isRunning && !isStopping) {
        return;
      }

      isStopping = true;
      isRunning = false;

      if (stream) {
        try {
          stream.removeAllListeners?.();
          await stream.close();
        } catch (closeError) {
          logger.warn(
            `Error closing change stream: ${
              closeError instanceof Error
                ? closeError.message
                : String(closeError)
            }`,
          );
        }
        stream = null;
      }

      // Wait for any currently queued events to complete
      await processingQueue;
      isStopping = false;
    },

    isRunning(): boolean {
      return isRunning;
    },
  };
}
