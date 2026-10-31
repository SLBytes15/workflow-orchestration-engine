import assert from "node:assert/strict";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import { Types } from "mongoose";
import {
  buildExecutionUpdateFilter,
  createExecutionService,
  ExecutionServiceError,
  type ExecutionServiceDependencies,
} from "./execution.service";
import type {
  ActionRegistry,
  RuntimeNodeResult,
  ValidatedActionInput,
} from "./execution.runtime";

const tenantId = new Types.ObjectId();
const otherTenantId = new Types.ObjectId();
const workflowId = new Types.ObjectId();
const executionId = new Types.ObjectId();

const workflow = {
  _id: workflowId,
  tenantId,
  version: 3,
  graph: {
    version: 1 as const,
    nodes: [
      {
        id: "trigger-1",
        type: "trigger" as const,
        position: { x: 0, y: 0 },
        data: { type: "trigger" as const, label: "Start" },
      },
    ],
    edges: [],
  },
};

const conditionalWorkflow = {
  ...workflow,
  graph: {
    version: 1 as const,
    nodes: [
      {
        id: "trigger-1",
        type: "trigger" as const,
        position: { x: 0, y: 0 },
        data: { type: "trigger" as const, label: "Start" },
      },
      {
        id: "condition-1",
        type: "condition" as const,
        position: { x: 100, y: 0 },
        data: {
          type: "condition" as const,
          label: "Payment approved?",
          config: {
            type: "clause" as const,
            clause: {
              left: "approved",
              op: "equals" as const,
              right: true,
            },
          },
        },
      },
      {
        id: "task-true",
        type: "task" as const,
        position: { x: 200, y: -50 },
        data: { type: "task" as const, label: "Approved path" },
      },
      {
        id: "task-false",
        type: "task" as const,
        position: { x: 200, y: 50 },
        data: { type: "task" as const, label: "Rejected path" },
      },
    ],
    edges: [
      { id: "edge-1", source: "trigger-1", target: "condition-1" },
      {
        id: "edge-2",
        source: "condition-1",
        target: "task-true",
        sourceHandle: "true",
      },
      {
        id: "edge-3",
        source: "condition-1",
        target: "task-false",
        sourceHandle: "false",
      },
    ],
  },
};


function makeDependencies(
  overrides: Partial<ExecutionServiceDependencies> = {},
): ExecutionServiceDependencies {
  return {
    findWorkflow: async () => workflow,
    createExecution: async (record) => ({
      ...record,
      _id: executionId,
      createdAt: new Date("2026-10-17T12:00:00.000Z"),
    }),
    updateExecution: async (_tenant, _id, _expectedStatus, _expectedResults, update) => ({
      _id: executionId,
      tenantId,
      workflowId,
      workflowVersion: 3,
      graphSnapshot: workflow.graph,
      ...update,
    }),
    findExecution: async () => ({ _id: executionId, tenantId }),
    findHistory: async () => [],
    ...overrides,
  };
}

test("executes and persists the final execution for the trusted tenant", async () => {
  const updates: Array<{
    tenant: Types.ObjectId;
    id: Types.ObjectId;
    expectedStatus: string;
    update: Record<string, unknown>;
  }> = [];


  const service = createExecutionService(
    makeDependencies({
      findWorkflow: async () => conditionalWorkflow,
      updateExecution: async (
        tenant,
        id,
        expectedStatus,
        _expectedResults,
        update,
      ) => {
        updates.push({
          tenant,
          id,
          expectedStatus,
          update: update as Record<string, unknown>,
        });

        return {
          _id: executionId,
          tenantId: tenant,
          workflowId,
          workflowVersion: 3,
          graphSnapshot: conditionalWorkflow.graph,
          ...update,
        };
      },
    }),
  );

const input = { approved: true };

const result = await service.startExecution(
  tenantId,
  String(workflowId),
  input,
);

  assert.equal(String(result.tenantId), String(tenantId));
  assert.equal(result.status, "completed");
  assert.equal(result.workflowVersion, 3);
  assert.deepEqual(result.nodeResults, [
    { nodeId: "trigger-1", status: "completed" },
    {
      nodeId: "condition-1",
      status: "completed",
      output: { result: true },
    },
    { nodeId: "task-true", status: "completed" },
  ]);

  assert.equal(updates.length, 2);
  assert.equal(updates[0].expectedStatus, "queued");
  assert.equal(updates[0].update.status, "running");
  assert.equal(updates[1].expectedStatus, "running");
  assert.equal(updates[1].update.status, "completed");

  for (const update of updates) {
    assert.equal(String(update.tenant), String(tenantId));
    assert.equal(String(update.id), String(executionId));
  }
});


test("persists a failed execution when the graph is invalid", async () => {
  const invalidWorkflow = {
    ...workflow,
    graph: { version: 1 as const, nodes: [], edges: [] },
  };

  const updates: Array<Record<string, unknown>> = [];

  const service = createExecutionService(
    makeDependencies({
      findWorkflow: async () => invalidWorkflow,
      updateExecution: async (
        _tenant,
        _id,
        _expectedStatus,
        _expectedResults,
        update,
      ) => {
        updates.push(update as Record<string, unknown>);

        return {
          _id: executionId,
          tenantId,
          workflowId,
          workflowVersion: 3,
          graphSnapshot: invalidWorkflow.graph,
          ...update,
        };
      },
    }),
  );

  const result = await service.startExecution(tenantId, String(workflowId));

  assert.equal(result.status, "failed");
  assert.equal((result.error as { code: string }).code, "INVALID_GRAPH");
  assert.ok(result.completedAt);

  assert.equal(updates.length, 2);
  assert.equal(updates[0].status, "running");
  assert.equal(updates[1].status, "failed");
});

test("does not create an execution for a workflow outside the tenant scope", async () => {
  let created = false;

  const service = createExecutionService(
    makeDependencies({
      findWorkflow: async (tenant) => {
        assert.equal(String(tenant), String(otherTenantId));
        return null;
      },
      createExecution: async (record) => {
        created = true;
        return record;
      },
    }),
  );

  await assert.rejects(
    service.startExecution(otherTenantId, String(workflowId)),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.statusCode === 404 &&
      error.code === "WORKFLOW_NOT_FOUND",
  );

  assert.equal(created, false);
});

test("returns an error if the running state cannot be persisted", async () => {
  const service = createExecutionService(
    makeDependencies({
      updateExecution: async () => null,
    }),
  );

  await assert.rejects(
    service.startExecution(tenantId, String(workflowId)),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.statusCode === 500 &&
      error.code === "EXECUTION_STATE_UPDATE_FAILED",
  );
});

test("returns an error if terminal results cannot be persisted", async () => {
  let calls = 0;

  const service = createExecutionService(
    makeDependencies({
      updateExecution: async (
        _tenant,
        _id,
        _expectedStatus,
        _expectedResults,
        update,
      ) => {
        calls += 1;
        if (calls === 1) {
          return { _id: executionId, status: "running" };
        }
        return null;
      },
    }),
  );

  await assert.rejects(
    service.startExecution(tenantId, String(workflowId)),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.statusCode === 500 &&
      error.code === "EXECUTION_RESULT_PERSISTENCE_FAILED",
  );
});

test("scopes execution lookup to the supplied tenant", async () => {
  const service = createExecutionService(
    makeDependencies({
      findExecution: async (tenant, id) => {
        assert.equal(String(tenant), String(otherTenantId));
        assert.equal(String(id), String(executionId));
        return null;
      },
    }),
  );

  await assert.rejects(
    service.getExecution(otherTenantId, String(executionId)),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.statusCode === 404 &&
      error.code === "EXECUTION_NOT_FOUND",
  );
});

test("rejects malformed IDs and invalid history limits", async () => {
  const service = createExecutionService(makeDependencies());

  await assert.rejects(
    service.getExecution(tenantId, "not-an-id"),
    (error: unknown) =>
      error instanceof ExecutionServiceError && error.statusCode === 400,
  );

  await assert.rejects(
    service.listExecutions(tenantId, String(workflowId), 101, undefined),
    (error: unknown) =>
      error instanceof ExecutionServiceError && error.statusCode === 400,
  );
});

test("paginates history and returns a cursor when more records exist", async () => {
  const records = [
    { _id: new Types.ObjectId("000000000000000000000003") },
    { _id: new Types.ObjectId("000000000000000000000002") },
    { _id: new Types.ObjectId("000000000000000000000001") },
  ];

  const service = createExecutionService(
    makeDependencies({
      findHistory: async (tenant, id, limit, cursor) => {
        assert.equal(String(tenant), String(tenantId));
        assert.equal(String(id), String(workflowId));
        assert.equal(limit, 2);
        assert.equal(cursor, undefined);
        return records;
      },
    }),
  );

  const result = await service.listExecutions(
    tenantId,
    String(workflowId),
    2,
    undefined,
  );

  assert.equal(result.executions.length, 2);
  assert.equal(result.pagination.hasMore, true);
  assert.equal(result.pagination.nextCursor, "000000000000000000000002");
});

test("rejects an invalid history cursor", async () => {
  const service = createExecutionService(makeDependencies());

  await assert.rejects(
    service.listExecutions(
      tenantId,
      String(workflowId),
      20,
      "not-an-object-id",
    ),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.statusCode === 400 &&
      error.code === "VALIDATION_ERROR",
  );
});

test("rejects fractional history limits", async () => {
  const service = createExecutionService(makeDependencies());

  await assert.rejects(
    service.listExecutions(tenantId, String(workflowId), 1.5, undefined),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.statusCode === 400 &&
      error.code === "VALIDATION_ERROR",
  );
});

test("returns no next cursor when history has no additional records", async () => {
  const service = createExecutionService(
    makeDependencies({
      findHistory: async () => [{ _id: executionId }],
    }),
  );

  const result = await service.listExecutions(
    tenantId,
    String(workflowId),
    2,
    undefined,
  );

  assert.equal(result.executions.length, 1);
  assert.equal(result.pagination.hasMore, false);
  assert.equal(result.pagination.nextCursor, null);
});

test("guards competing checkpoints with an exact prior node-results snapshot", async () => {
  const previousResults: RuntimeNodeResult[] = [
    {
      nodeId: "task-a",
      status: "completed",
      compensation: {
        status: "running",
        startedAt: null,
        completedAt: null,
        error: null,
      },
    },
  ];
  const firstFilter = buildExecutionUpdateFilter(
    tenantId,
    executionId,
    "compensating",
    previousResults,
  );
  const competingFilter = buildExecutionUpdateFilter(
    tenantId,
    executionId,
    "compensating",
    previousResults,
  );
  const document: {
    tenantId: Types.ObjectId;
    _id: Types.ObjectId;
    status: string;
    nodeResults: RuntimeNodeResult[];
  } = {
    tenantId,
    _id: executionId,
    status: "compensating",
    nodeResults: structuredClone(previousResults),
  };
  const applyAtomicUpdate = (
    filter: Record<string, unknown>,
    nextResults: RuntimeNodeResult[],
  ): boolean => {
    if (
      String(filter.tenantId) !== String(document.tenantId) ||
      String(filter._id) !== String(document._id) ||
      filter.status !== document.status ||
      !isDeepStrictEqual(document.nodeResults, filter.nodeResults)
    ) {
      return false;
    }

    document.nodeResults = nextResults;
    return true;
  };

  const results = await Promise.all([
    Promise.resolve().then(() =>
      applyAtomicUpdate(firstFilter, [
        {
          nodeId: "task-a",
          status: "completed",
          compensation: {
            status: "completed",
            startedAt: null,
            completedAt: null,
            error: null,
          },
        },
      ]),
    ),
    Promise.resolve().then(() =>
      applyAtomicUpdate(competingFilter, [
        {
          nodeId: "task-a",
          status: "completed",
          compensation: {
            status: "failed",
            startedAt: null,
            completedAt: null,
            error: null,
          },
        },
      ]),
    ),
  ]);

  assert.deepEqual(results, [true, false]);
  assert.equal(
    (document.nodeResults[0].compensation as { status: string }).status,
    "completed",
  );
});

interface SagaTask {
  nodeId: string;
  actionId: string;
  compensationActionId?: string;
  timeoutMs?: number;
  retry?: { attempts: number; backoffMs: number };
}

function sagaWorkflow(tasks: SagaTask[]) {
  const nodes = [
    {
      id: "trigger-1",
      type: "trigger" as const,
      position: { x: 0, y: 0 },
      data: { type: "trigger" as const, label: "Start" },
    },
    ...tasks.map((task, index) => ({
      id: task.nodeId,
      type: "task" as const,
      position: { x: (index + 1) * 100, y: 0 },
      data: {
        type: "task" as const,
        label: task.nodeId,
        config: {
          action: task.actionId,
          expression: task.nodeId,
          taskId: task.nodeId,
          ...(task.timeoutMs !== undefined ? { timeoutMs: task.timeoutMs } : {}),
          ...(task.compensationActionId
            ? {
                compensationAction: task.compensationActionId,
                compensationConfig: { taskId: task.nodeId },
              }
            : {}),
        },
        ...(task.retry ? { retry: task.retry } : {}),
      },
    })),
  ];

  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `edge-${index + 1}`,
    source: node.id,
    target: nodes[index + 1].id,
  }));

  return {
    ...workflow,
    graph: { version: 1 as const, nodes, edges },
  };
}

function sagaDependencies(
  graph: ReturnType<typeof sagaWorkflow>,
  actions: ActionRegistry,
  updates: Array<{
    expectedStatus: string;
    expectedResults?: unknown;
    update: Record<string, unknown>;
  }>,
) {
  return makeDependencies({
    findWorkflow: async () => graph,
    actions,
    updateExecution: async (
      _tenant,
      _id,
      expectedStatus,
      expectedResults,
      update,
    ) => {
      updates.push({
        expectedStatus,
        expectedResults: structuredClone(expectedResults),
        update: structuredClone(update) as Record<string, unknown>,
      });

      return {
        _id: executionId,
        tenantId,
        workflowId,
        workflowVersion: 3,
        graphSnapshot: graph.graph,
        ...structuredClone(update),
      };
    },
  });
}

test("persists failure when a successful task returns non-JSON output", async () => {
  const graph = {
    ...workflow,
    graph: {
      version: 1 as const,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger" as const,
          position: { x: 0, y: 0 },
          data: { type: "trigger" as const, label: "Start" },
        },
        {
          id: "task-a",
          type: "task" as const,
          position: { x: 100, y: 0 },
          data: {
            type: "task" as const,
            label: "Run action",
            config: { action: "transform", expression: "run" },
          },
        },
      ],
      edges: [{ id: "edge-1", source: "trigger-1", target: "task-a" }],
    },
  };
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  let externalSideEffectCompleted = false;
  const updates: Array<Record<string, unknown>> = [];
  const service = createExecutionService(
    makeDependencies({
      findWorkflow: async () => graph,
      actions: {
        taskActions: {
          transform: {
            execute: async () => {
              externalSideEffectCompleted = true;
              return { ok: true, output: cyclic };
            },
          },
        },
      },
      updateExecution: async (
        _tenant,
        _id,
        _expectedStatus,
        _expectedNodeResults,
        update,
      ) => {
        updates.push(structuredClone(update) as Record<string, unknown>);
        return {
          _id: executionId,
          tenantId,
          workflowId,
          workflowVersion: 3,
          graphSnapshot: graph.graph,
          ...update,
        };
      },
    }),
  );

  const result = await service.startExecution(tenantId, String(workflowId));

  assert.equal(externalSideEffectCompleted, true);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.error, {
    code: "INVALID_ACTION_OUTPUT",
    message:
      "The action succeeded but returned output outside the JSON value contract.",
  });
  assert.equal(result.nodeResults[1].status, "completed");
  assert.equal(result.nodeResults[1].output, undefined);
  assert.equal(result.nodeResults[1].error?.code, "INVALID_ACTION_OUTPUT");
  assert.equal(updates.at(-1)?.status, "failed");
  assert.deepEqual(updates.at(-1)?.nodeResults, result.nodeResults);
});

test("reports terminal persistence failure after an action handler succeeds", async () => {
  const graph = {
    ...workflow,
    graph: {
      version: 1 as const,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger" as const,
          position: { x: 0, y: 0 },
          data: { type: "trigger" as const, label: "Start" },
        },
        {
          id: "task-a",
          type: "task" as const,
          position: { x: 100, y: 0 },
          data: {
            type: "task" as const,
            label: "Run action",
            config: { action: "transform", expression: "run" },
          },
        },
      ],
      edges: [{ id: "edge-1", source: "trigger-1", target: "task-a" }],
    },
  };
  let actionSucceeded = false;
  let updateCount = 0;
  const service = createExecutionService(
    makeDependencies({
      findWorkflow: async () => graph,
      actions: {
        taskActions: {
          transform: {
            execute: async () => {
              actionSucceeded = true;
              return { ok: true as const, output: { accepted: true } };
            },
          },
        },
      },
      updateExecution: async (
        _tenant,
        _id,
        _expectedStatus,
        _expectedNodeResults,
        update,
      ) => {
        updateCount += 1;
        if (updateCount === 1) {
          return {
            _id: executionId,
            tenantId,
            workflowId,
            workflowVersion: 3,
            graphSnapshot: graph.graph,
            ...update,
          };
        }
        return null;
      },
    }),
  );

  await assert.rejects(
    service.startExecution(tenantId, String(workflowId)),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.code === "EXECUTION_RESULT_PERSISTENCE_FAILED",
  );
  assert.equal(actionSucceeded, true);
});

test("compensates a completed task after the next task fails and persists checkpoints", async () => {
  const graph = sagaWorkflow([
    {
      nodeId: "task-a",
      actionId: "transform",
      compensationActionId: "orders.release",
    },
    {
      nodeId: "task-b",
      actionId: "transform",
      compensationActionId: "orders.release-b",
    },
  ]);
  const actionOrder: string[] = [];
  const actions: ActionRegistry = {
    taskActions: {
      transform: {
        execute: async (input: ValidatedActionInput) => {
          const taskId = input.taskId;
          actionOrder.push(`task-${taskId}`);
          if (taskId === "task-a") {
            assert.deepEqual(input, {
              action: "transform",
              expression: "task-a",
              taskId: "task-a",
            });
            return {
              ok: true as const,
              output: { reservationId: "reservation-1" },
            };
          }
          return {
            ok: false as const,
            error: { code: "PAYMENT_DECLINED", message: "Payment was declined." },
          };
        },
      },
    },
    compensationActions: {
      "orders.release": {
        execute: async (context) => {
          actionOrder.push("compensate-a");
          assert.equal(context.executionId, String(executionId));
          assert.equal(context.workflowId, String(workflowId));
          assert.equal(context.tenantId, String(tenantId));
          assert.equal(context.nodeId, "task-a");
          assert.equal(context.taskAction, "transform");
          assert.deepEqual(context.taskConfig, {
            action: "transform",
            expression: "task-a",
            taskId: "task-a",
          });
          assert.deepEqual(context.compensationConfig, { taskId: "task-a" });
          assert.deepEqual(context.taskOutput, {
            reservationId: "reservation-1",
          });
          return { ok: true as const };
        },
      },
      "orders.release-b": {
        execute: async () => {
          actionOrder.push("compensate-b");
          return { ok: true as const };
        },
      },
    },
  };
  const updates: Array<{
    expectedStatus: string;
    update: Record<string, unknown>;
  }> = [];
  const service = createExecutionService(
    sagaDependencies(graph, actions, updates),
  );

  const result = await service.startExecution(tenantId, String(workflowId));
  const compensationStates = updates
    .filter((entry) => entry.update.status === "compensating")
    .map((entry) => {
      const nodes = entry.update.nodeResults as Array<{
        nodeId: string;
        compensation?: { status: string };
      }>;
      return nodes.find((node) => node.nodeId === "task-a")?.compensation
        ?.status;
    });

  assert.deepEqual(actionOrder, [
    "task-task-a",
    "task-task-b",
    "compensate-a",
  ]);
  assert.deepEqual(
    updates.map((entry) => entry.update.status),
    ["running", "compensating", "compensating", "compensating", "compensated"],
  );
  assert.deepEqual(
    updates.map((entry) => entry.expectedStatus),
    ["queued", "running", "compensating", "compensating", "compensating"],
  );
  assert.deepEqual(compensationStates, ["pending", "running", "completed"]);
  assert.equal(result.status, "compensated");
  assert.equal(result.nodeResults[2].compensation, undefined);
  assert.deepEqual(result.error, {
    code: "PAYMENT_DECLINED",
    message: "Payment was declined.",
  });
  assert.deepEqual(
    result.nodeResults.map((node: { nodeId: string; status: string }) => [
      node.nodeId,
      node.status,
    ]),
    [
      ["trigger-1", "completed"],
      ["task-a", "completed"],
      ["task-b", "failed"],
    ],
  );
  const taskACompensation = result.nodeResults[1].compensation;
  assert.ok(taskACompensation);
  assert.equal(taskACompensation.status, "completed");
  assert.ok(taskACompensation.startedAt instanceof Date);
  assert.ok(taskACompensation.completedAt instanceof Date);
  assert.equal(taskACompensation.error, null);
  const persistedNodes = updates.at(-1)?.update.nodeResults as Array<{
    nodeId: string;
    status: string;
    compensation?: { status: string };
  }>;
  assert.equal(
    persistedNodes.find((node) => node.nodeId === "task-a")?.compensation
      ?.status,
    "completed",
  );
  assert.equal(
    persistedNodes.find((node) => node.nodeId === "task-b")?.status,
    "failed",
  );
});

test("compensates eligible tasks in reverse task-completion order", async () => {
  const graph = sagaWorkflow([
    {
      nodeId: "task-a",
      actionId: "transform",
      compensationActionId: "compensate.a",
    },
    {
      nodeId: "task-b",
      actionId: "transform",
      compensationActionId: "compensate.b",
    },
    { nodeId: "task-c", actionId: "transform" },
  ]);
  const actionOrder: string[] = [];
  const actions = {
    taskActions: {
      transform: {
        execute: async (input: ValidatedActionInput) => {
          const taskId = String(input.taskId);
          actionOrder.push(`task-${taskId}`);
          return taskId === "task-c"
            ? {
                ok: false as const,
                error: { code: "TASK_C_FAILED", message: "Task C failed." },
              }
            : { ok: true as const };
        },
      },
    },
    compensationActions: {
      "compensate.a": {
        execute: async () => {
          actionOrder.push("compensate-a");
          return { ok: true as const };
        },
      },
      "compensate.b": {
        execute: async () => {
          actionOrder.push("compensate-b");
          return { ok: true as const };
        },
      },
    },
  };
  const updates: Array<{
    expectedStatus: string;
    update: Record<string, unknown>;
  }> = [];
  const service = createExecutionService(
    sagaDependencies(graph, actions, updates),
  );

  const result = await service.startExecution(tenantId, String(workflowId));

  assert.deepEqual(actionOrder, [
    "task-task-a",
    "task-task-b",
    "task-task-c",
    "compensate-b",
    "compensate-a",
  ]);
  assert.equal(result.status, "compensated");
  assert.equal(
    (result.nodeResults[1].compensation as { status: string }).status,
    "completed",
  );
  assert.equal(
    (result.nodeResults[2].compensation as { status: string }).status,
    "completed",
  );
  const finalUpdate = updates.at(-1)?.update;
  assert.equal(finalUpdate?.status, "compensated");
  const finalNodes = finalUpdate?.nodeResults as Array<{
    nodeId: string;
    compensation?: { status: string };
  }>;
  assert.deepEqual(
    finalNodes
      .filter((node) => node.compensation)
      .map((node) => [node.nodeId, node.compensation?.status]),
    [
      ["task-a", "completed"],
      ["task-b", "completed"],
    ],
  );
});

test("preserves task errors separately from compensation errors", async () => {
  const graph = sagaWorkflow([
    {
      nodeId: "task-a",
      actionId: "transform",
      compensationActionId: "compensate.a",
    },
    { nodeId: "task-b", actionId: "transform" },
  ]);
  const taskError = {
    code: "TASK_B_FAILED",
    message: "Task B failed.",
  };
  const compensationError = {
    code: "COMPENSATION_REJECTED",
    message: "Compensation A failed.",
  };
  const actions = {
    taskActions: {
      transform: {
        execute: async (input: ValidatedActionInput) =>
          input.taskId === "task-a"
            ? { ok: true as const }
            : { ok: false as const, error: taskError },
      },
    },
    compensationActions: {
      "compensate.a": {
        execute: async () => ({ ok: false as const, error: compensationError }),
      },
    },
  };
  const updates: Array<{
    expectedStatus: string;
    update: Record<string, unknown>;
  }> = [];
  const service = createExecutionService(
    sagaDependencies(graph, actions, updates),
  );

  const result = await service.startExecution(tenantId, String(workflowId));
  const taskA = result.nodeResults[1] as {
    compensation: {
      status: string;
      startedAt: Date | null;
      completedAt: Date | null;
      error: unknown;
    };
  };

  assert.equal(result.status, "compensation_failed");
  assert.deepEqual(result.error, taskError);
  assert.deepEqual(taskA.compensation, {
    status: "failed",
    startedAt: taskA.compensation.startedAt,
    completedAt: taskA.compensation.completedAt,
    error: compensationError,
  });
  assert.ok(taskA.compensation.startedAt instanceof Date);
  assert.ok(taskA.compensation.completedAt instanceof Date);
  assert.equal(updates.at(-1)?.update.status, "compensation_failed");
  assert.deepEqual(updates.at(-1)?.update.error, taskError);
  const persistedNodes = updates.at(-1)?.update.nodeResults as Array<{
    nodeId: string;
    compensation?: { status: string; error: unknown };
  }>;
  assert.deepEqual(
    persistedNodes.find((node) => node.nodeId === "task-a")?.compensation,
    taskA.compensation,
  );
});

test("compensates a successful side effect whose output violates the JSON contract", async () => {
  const graph = sagaWorkflow([
    {
      nodeId: "task-a",
      actionId: "transform",
      compensationActionId: "undo",
    },
  ]);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const actionOrder: string[] = [];
  const service = createExecutionService(
    sagaDependencies(
      graph,
      {
        taskActions: {
          transform: {
            execute: async () => {
              actionOrder.push("task");
              return { ok: true, output: cyclic };
            },
          },
        },
        compensationActions: {
          undo: {
            execute: async (context) => {
              actionOrder.push("compensate");
              assert.equal(context.taskOutput, undefined);
              return { ok: true };
            },
          },
        },
      },
      [],
    ),
  );

  const result = await service.startExecution(tenantId, String(workflowId));

  assert.deepEqual(actionOrder, ["task", "compensate"]);
  assert.equal(result.status, "compensated");
  assert.equal((result.error as { code: string }).code, "INVALID_ACTION_OUTPUT");
  assert.equal(result.nodeResults[1].status, "completed");
  assert.equal(result.nodeResults[1].error?.code, "INVALID_ACTION_OUTPUT");
  assert.equal(result.nodeResults[1].compensation?.status, "completed");
});

test("records multiple compensation failures without replacing the task error", async () => {
  const taskError = { code: "TASK_C_FAILED", message: "Task C failed." };
  const graph = sagaWorkflow([
    { nodeId: "task-a", actionId: "transform", compensationActionId: "undo-a" },
    { nodeId: "task-b", actionId: "transform", compensationActionId: "undo-b" },
    { nodeId: "task-c", actionId: "transform" },
  ]);
  const actionOrder: string[] = [];
  const service = createExecutionService(
    sagaDependencies(
      graph,
      {
        taskActions: {
          transform: {
            execute: async (input) => {
              const taskId = String(input.taskId);
              actionOrder.push(`task-${taskId}`);
              return taskId === "task-c"
                ? { ok: false as const, error: taskError }
                : { ok: true as const };
            },
          },
        },
        compensationActions: {
          "undo-a": {
            execute: async () => {
              actionOrder.push("undo-a");
              return {
                ok: false,
                error: { code: "UNDO_A_FAILED", message: "Undo A failed." },
              };
            },
          },
          "undo-b": {
            execute: async () => {
              actionOrder.push("undo-b");
              return {
                ok: false,
                error: { code: "UNDO_B_FAILED", message: "Undo B failed." },
              };
            },
          },
        },
      },
      [],
    ),
  );

  const result = await service.startExecution(tenantId, String(workflowId));

  assert.deepEqual(actionOrder, [
    "task-task-a",
    "task-task-b",
    "task-task-c",
    "undo-b",
    "undo-a",
  ]);
  assert.equal(result.status, "compensation_failed");
  assert.deepEqual(result.error, taskError);
  assert.equal(result.nodeResults[1].compensation?.status, "failed");
  assert.deepEqual(result.nodeResults[1].compensation?.error, {
    code: "UNDO_A_FAILED",
    message: "Undo A failed.",
  });
  assert.equal(result.nodeResults[2].compensation?.status, "failed");
  assert.deepEqual(result.nodeResults[2].compensation?.error, {
    code: "UNDO_B_FAILED",
    message: "Undo B failed.",
  });
  assert.equal(result.nodeResults[3].compensation, undefined);
});

test("excludes tasks skipped by condition routing from compensation", async () => {
  const graph = {
    ...workflow,
    graph: {
      version: 1 as const,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger" as const,
          position: { x: 0, y: 0 },
          data: { type: "trigger" as const, label: "Start" },
        },
        {
          id: "condition-1",
          type: "condition" as const,
          position: { x: 100, y: 0 },
          data: {
            type: "condition" as const,
            label: "Choose path",
            config: {
              type: "clause" as const,
              clause: { left: "approved", op: "equals" as const, right: true },
            },
          },
        },
        {
          id: "task-a",
          type: "task" as const,
          position: { x: 200, y: -50 },
          data: {
            type: "task" as const,
            label: "Task A",
            config: {
              action: "transform",
              expression: "task-a",
              taskId: "task-a",
              compensationAction: "undo",
              compensationConfig: { taskId: "task-a" },
            },
          },
        },
        {
          id: "task-skipped",
          type: "task" as const,
          position: { x: 200, y: 50 },
          data: {
            type: "task" as const,
            label: "Skipped",
            config: {
              action: "transform",
              expression: "task-skipped",
              taskId: "task-skipped",
              compensationAction: "undo",
              compensationConfig: { taskId: "task-skipped" },
            },
          },
        },
        {
          id: "task-b",
          type: "task" as const,
          position: { x: 300, y: -50 },
          data: {
            type: "task" as const,
            label: "Task B",
            config: { action: "transform", expression: "task-b", taskId: "task-b" },
          },
        },
      ],
      edges: [
        { id: "edge-1", source: "trigger-1", target: "condition-1" },
        {
          id: "edge-2",
          source: "condition-1",
          target: "task-a",
          sourceHandle: "true",
        },
        {
          id: "edge-3",
          source: "condition-1",
          target: "task-skipped",
          sourceHandle: "false",
        },
        { id: "edge-4", source: "task-a", target: "task-b" },
      ],
    },
  };
  const actionOrder: string[] = [];
  const service = createExecutionService(
    makeDependencies({
      findWorkflow: async () => graph,
      actions: {
        taskActions: {
          transform: {
            execute: async (input) => {
              const taskId = String(input.taskId);
              actionOrder.push(`task-${taskId}`);
              return taskId === "task-b"
                ? {
                    ok: false as const,
                    error: { code: "TASK_B_FAILED", message: "Task B failed." },
                  }
                : { ok: true as const };
            },
          },
        },
        compensationActions: {
          undo: {
            execute: async (context) => {
              actionOrder.push(`undo-${context.nodeId}`);
              return { ok: true };
            },
          },
        },
      },
      updateExecution: async (
        _tenant,
        _id,
        _expectedStatus,
        _expectedResults,
        update,
      ) => ({
        _id: executionId,
        tenantId,
        workflowId,
        workflowVersion: 3,
        graphSnapshot: graph.graph,
        ...update,
      }),
    }),
  );

  const result = await service.startExecution(tenantId, String(workflowId), {
    approved: true,
  });

  assert.deepEqual(actionOrder, ["task-task-a", "task-task-b", "undo-task-a"]);
  assert.equal(
    result.nodeResults.some((node: RuntimeNodeResult) => node.nodeId === "task-skipped"),
    false,
  );
  assert.equal(result.status, "compensated");
});

test("records a thrown compensation handler as a separate compensation failure", async () => {
  const graph = sagaWorkflow([
    { nodeId: "task-a", actionId: "transform", compensationActionId: "undo" },
    { nodeId: "task-b", actionId: "transform" },
  ]);
  const service = createExecutionService(
    sagaDependencies(
      graph,
      {
        taskActions: {
          transform: {
            execute: async (input) =>
              input.taskId === "task-b"
                ? {
                    ok: false as const,
                    error: {
                      code: "TASK_B_FAILED",
                      message: "Task B failed.",
                    },
                  }
                : { ok: true as const },
          },
        },
        compensationActions: {
          undo: {
            execute: async () => {
              throw new Error("private handler detail");
            },
          },
        },
      },
      [],
    ),
  );

  const result = await service.startExecution(tenantId, String(workflowId));

  assert.equal(result.status, "compensation_failed");
  assert.deepEqual(result.error, {
    code: "TASK_B_FAILED",
    message: "Task B failed.",
  });
  assert.deepEqual(result.nodeResults[1].compensation?.error, {
    code: "COMPENSATION_HANDLER_FAILED",
    message: "The registered compensation handler failed unexpectedly.",
  });
});

test("does not call compensation when its pre-handler checkpoint fails", async () => {
  const graph = sagaWorkflow([
    { nodeId: "task-a", actionId: "transform", compensationActionId: "undo" },
    { nodeId: "task-b", actionId: "transform" },
  ]);
  const updates: Array<Record<string, unknown>> = [];
  let compensationCalled = false;
  let updateCount = 0;
  let persisted: Record<string, unknown> = {
    status: "queued",
    nodeResults: [],
  };
  const service = createExecutionService(
    makeDependencies({
      findWorkflow: async () => graph,
      actions: {
        taskActions: {
          transform: {
            execute: async (input) =>
              input.taskId === "task-b"
                ? {
                    ok: false as const,
                    error: { code: "TASK_FAILED", message: "Task failed." },
                  }
                : { ok: true as const },
          },
        },
        compensationActions: {
          undo: {
            execute: async () => {
              compensationCalled = true;
              return { ok: true };
            },
          },
        },
      },
      updateExecution: async (
        _tenant,
        _id,
        _expectedStatus,
        _expectedResults,
        update,
      ) => {
        updateCount += 1;
        updates.push(structuredClone(update) as Record<string, unknown>);
        if (updateCount === 3) return null;
        persisted = structuredClone(update) as Record<string, unknown>;
        return {
          _id: executionId,
          tenantId,
          workflowId,
          workflowVersion: 3,
          graphSnapshot: graph.graph,
          ...update,
        };
      },
    }),
  );

  await assert.rejects(
    service.startExecution(tenantId, String(workflowId)),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.code === "COMPENSATION_CHECKPOINT_FAILED",
  );
  assert.equal(compensationCalled, false);
  assert.deepEqual(
    updates.map((update) => update.status),
    ["running", "compensating", "compensating"],
  );
  assert.equal(
    (updates[1].nodeResults as RuntimeNodeResult[])[1].compensation?.status,
    "pending",
  );
  assert.equal(
    ((persisted.nodeResults as RuntimeNodeResult[])[1].compensation)
      ?.status,
    "pending",
  );
});

test("reports ambiguous compensation outcome when its terminal checkpoint fails", async () => {
  const graph = sagaWorkflow([
    { nodeId: "task-a", actionId: "transform", compensationActionId: "undo" },
    { nodeId: "task-b", actionId: "transform" },
  ]);
  const updates: Array<Record<string, unknown>> = [];
  let compensationCalls = 0;
  let updateCount = 0;
  let persisted: Record<string, unknown> = {
    status: "queued",
    nodeResults: [],
  };
  const service = createExecutionService(
    makeDependencies({
      findWorkflow: async () => graph,
      actions: {
        taskActions: {
          transform: {
            execute: async (input) =>
              input.taskId === "task-b"
                ? {
                    ok: false as const,
                    error: { code: "TASK_FAILED", message: "Task failed." },
                  }
                : { ok: true as const },
          },
        },
        compensationActions: {
          undo: {
            execute: async () => {
              compensationCalls += 1;
              return { ok: true };
            },
          },
        },
      },
      updateExecution: async (
        _tenant,
        _id,
        _expectedStatus,
        _expectedResults,
        update,
      ) => {
        updateCount += 1;
        updates.push(structuredClone(update) as Record<string, unknown>);
        if (updateCount === 4) return null;
        persisted = structuredClone(update) as Record<string, unknown>;
        return {
          _id: executionId,
          tenantId,
          workflowId,
          workflowVersion: 3,
          graphSnapshot: graph.graph,
          ...update,
        };
      },
    }),
  );

  await assert.rejects(
    service.startExecution(tenantId, String(workflowId)),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.code === "COMPENSATION_CHECKPOINT_FAILED" &&
      error.message.includes("may have run") &&
      error.message.includes("will not be replayed"),
  );
  assert.equal(compensationCalls, 1);
  assert.deepEqual(
    updates.map((update) => update.status),
    ["running", "compensating", "compensating", "compensating"],
  );
  assert.equal(
    (updates[2].nodeResults as RuntimeNodeResult[])[1].compensation?.status,
    "running",
  );
  assert.equal(
    persisted.status,
    "compensating",
  );
  assert.equal(
    (persisted.nodeResults as RuntimeNodeResult[])[1].compensation?.status,
    "running",
  );
});

test("compensates earlier completed tasks when a later task times out", async () => {
  const graph = sagaWorkflow([
    {
      nodeId: "task-a",
      actionId: "transform",
      compensationActionId: "undo-a",
    },
    { nodeId: "task-b", actionId: "transform", timeoutMs: 25 },
  ]);
  const actionOrder: string[] = [];
  const updates: Array<{
    expectedStatus: string;
    update: Record<string, unknown>;
  }> = [];
  let releasedReservation = false;

  const actions: ActionRegistry = {
    taskActions: {
      transform: {
        execute: async (input: ValidatedActionInput) => {
          const taskId = input.taskId;
          actionOrder.push(`task-${String(taskId)}`);
          if (taskId === "task-a") {
            return {
              ok: true as const,
              output: { reservationId: "reservation-1" },
            };
          }
          // Never settles: the configured timeout must be what ends the wait.
          return new Promise<never>(() => {});
        },
      },
    },
    compensationActions: {
      "undo-a": {
        execute: async (context) => {
          actionOrder.push("compensate-a");
          assert.equal(context.nodeId, "task-a");
          assert.deepEqual(context.taskOutput, {
            reservationId: "reservation-1",
          });
          releasedReservation = true;
          return { ok: true as const };
        },
      },
    },
  };

  const service = createExecutionService(
    sagaDependencies(graph, actions, updates),
  );

  const result = await service.startExecution(tenantId, String(workflowId));

  // The timed-out node must not prevent compensation of earlier work.
  assert.deepEqual(actionOrder, [
    "task-task-a",
    "task-task-b",
    "compensate-a",
  ]);
  assert.equal(releasedReservation, true);
  assert.equal(result.status, "compensated");
  assert.deepEqual(result.error, {
    code: "ACTION_TIMEOUT",
    message: "The task action exceeded its configured timeout.",
  });
  assert.deepEqual(
    result.nodeResults.map((node: { nodeId: string; status: string }) => [
      node.nodeId,
      node.status,
    ]),
    [
      ["trigger-1", "completed"],
      ["task-a", "completed"],
      ["task-b", "failed"],
    ],
  );
  assert.equal(result.nodeResults[2]?.error?.code, "ACTION_TIMEOUT");
  assert.equal(result.nodeResults[1]?.compensation?.status, "completed");
  assert.equal(result.nodeResults[2]?.compensation, undefined);
  assert.deepEqual(
    updates.map((entry) => entry.update.status),
    ["running", "compensating", "compensating", "compensating", "compensated"],
  );
  assert.deepEqual(
    updates.map((entry) => entry.expectedStatus),
    ["queued", "running", "compensating", "compensating", "compensating"],
  );
});

test("keeps the recorded timeout failure when the handler settles late", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);

  const runScenario = async (lateSettlement: "resolve" | "reject") => {
    let resolveLate:
      | ((value: { ok: true; output: { late: true } }) => void)
      | undefined;
    let rejectLate: ((reason: Error) => void) | undefined;
    const lateResult = new Promise<{ ok: true; output: { late: true } }>(
      (resolve, reject) => {
        resolveLate = resolve;
        rejectLate = reject;
      },
    );

    const graph = sagaWorkflow([
      {
        nodeId: "task-a",
        actionId: "transform",
        compensationActionId: "undo-a",
      },
      { nodeId: "task-b", actionId: "transform", timeoutMs: 25 },
    ]);
    const updates: Array<{
      expectedStatus: string;
      update: Record<string, unknown>;
    }> = [];
    let compensationCalls = 0;

    const actions: ActionRegistry = {
      taskActions: {
        transform: {
          execute: async (input: ValidatedActionInput) => {
            if (input.taskId === "task-b") {
              return lateResult;
            }
            return {
              ok: true as const,
              output: { reservationId: "reservation-1" },
            };
          },
        },
      },
      compensationActions: {
        "undo-a": {
          execute: async () => {
            compensationCalls += 1;
            return { ok: true as const };
          },
        },
      },
    };

    const service = createExecutionService(
      sagaDependencies(graph, actions, updates),
    );

    const result = await service.startExecution(tenantId, String(workflowId));

    const nodeResultsAtTimeout = structuredClone(result.nodeResults);
    const checkpointsAtTimeout = updates.length;

    assert.equal(result.status, "compensated");
    assert.equal(result.nodeResults[2]?.status, "failed");
    assert.equal(result.nodeResults[2]?.error?.code, "ACTION_TIMEOUT");
    assert.equal(compensationCalls, 1);

    if (lateSettlement === "resolve") {
      resolveLate?.({ ok: true, output: { late: true } });
    } else {
      rejectLate?.(new Error("late handler failure"));
    }

    // Let the late settlement propagate through the discarded race handlers.
    await new Promise((done) => setTimeout(done, 20));

    // The late result must not overwrite the recorded failure ...
    assert.deepEqual(result.nodeResults, nodeResultsAtTimeout);
    assert.equal(result.nodeResults[2]?.status, "failed");
    assert.equal(result.nodeResults[2]?.error?.code, "ACTION_TIMEOUT");
    assert.equal(result.nodeResults[2]?.output, undefined);
    // ... must not trigger a new checkpoint or further compensation ...
    assert.equal(updates.length, checkpointsAtTimeout);
    assert.equal(compensationCalls, 1);
    assert.equal(result.status, "compensated");
    assert.equal(result.nodeResults[2]?.compensation, undefined);
  };

  try {
    await runScenario("resolve");
    await runScenario("reject");
    // Neither the late success nor the late rejection may escape as unhandled.
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("does not retry a failed task when the node declares a retry policy", async () => {
  const graph = sagaWorkflow([
    {
      nodeId: "task-a",
      actionId: "transform",
      retry: { attempts: 3, backoffMs: 10 },
    },
  ]);
  const calls: string[] = [];
  const updates: Array<{
    expectedStatus: string;
    update: Record<string, unknown>;
  }> = [];

  const actions: ActionRegistry = {
    taskActions: {
      transform: {
        execute: async (input: ValidatedActionInput) => {
          calls.push(String(input.taskId));
          return {
            ok: false as const,
            error: { code: "HTTP_503", message: "Upstream unavailable." },
          };
        },
      },
    },
  };

  const service = createExecutionService(
    sagaDependencies(graph, actions, updates),
  );
  const result = await service.startExecution(tenantId, String(workflowId));

  assert.deepEqual(calls, ["task-a"]);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.error, {
    code: "HTTP_503",
    message: "Upstream unavailable.",
  });

  // One running update and one terminal failed update: no retry-wait state exists.
  assert.deepEqual(
    updates.map((entry) => entry.update.status),
    ["running", "failed"],
  );

  const terminal = updates[updates.length - 1];
  assert.deepEqual(terminal.update.error, {
    code: "HTTP_503",
    message: "Upstream unavailable.",
  });
  assert.equal(terminal.update.completedAt instanceof Date, true);
});

test("dispatches each task exactly once per execution when a later task fails", async () => {
  const graph = sagaWorkflow([
    { nodeId: "task-a", actionId: "transform" },
    {
      nodeId: "task-b",
      actionId: "transform",
      retry: { attempts: 2, backoffMs: 5 },
    },
  ]);
  const calls: string[] = [];
  const updates: Array<{
    expectedStatus: string;
    update: Record<string, unknown>;
  }> = [];

  const actions: ActionRegistry = {
    taskActions: {
      transform: {
        execute: async (input: ValidatedActionInput) => {
          const taskId = String(input.taskId);
          calls.push(taskId);
          if (taskId === "task-b") {
            return {
              ok: false as const,
              error: { code: "ACTION_FAILED", message: "Downstream failed." },
            };
          }
          return { ok: true as const, output: { taskId } };
        },
      },
    },
  };

  const service = createExecutionService(
    sagaDependencies(graph, actions, updates),
  );
  const result = await service.startExecution(tenantId, String(workflowId));

  // Duplicate-dispatch guard: each node is dispatched exactly once.
  assert.deepEqual(calls, ["task-a", "task-b"]);
  assert.equal(result.status, "failed");
  assert.deepEqual(
    result.nodeResults.map((node: { nodeId: string; status: string }) => [
      node.nodeId,
      node.status,
    ]),
    [
      ["trigger-1", "completed"],
      ["task-a", "completed"],
      ["task-b", "failed"],
    ],
  );
});

test("notifies each persisted state only after the write succeeded", async () => {
  const graph = sagaWorkflow([{ nodeId: "task-a", actionId: "transform" }]);
  const updates: Array<{ expectedStatus: string; update: Record<string, unknown> }> = [];
  const actions: ActionRegistry = {
    taskActions: {
      transform: {
        execute: async (input: ValidatedActionInput) => ({
          ok: true as const,
          output: { taskId: String(input.taskId) },
        }),
      },
    },
  };
  const notifications: Array<{ status: string; persistedWrites: number }> = [];

  const service = createExecutionService(
    sagaDependencies(graph, actions, updates),
    actions,
    (execution) => {
      notifications.push({
        status: execution.status,
        persistedWrites: updates.length,
      });
    },
  );

  const result = await service.startExecution(tenantId, String(workflowId));

  assert.equal(result.status, "completed");
  assert.deepEqual(
    updates.map((entry) => entry.update.status),
    ["running", "completed"],
  );
  // The notification for a state is emitted after that state was written.
  assert.deepEqual(notifications, [
    { status: "running", persistedWrites: 1 },
    { status: "completed", persistedWrites: 2 },
  ]);
});

test("publishes the persisted failed status for a terminal failure", async () => {
  const invalidWorkflow = {
    ...workflow,
    graph: { version: 1 as const, nodes: [], edges: [] },
  };
  const updates: Array<Record<string, unknown>> = [];
  const notifications: Array<{ status: string; persistedWrites: number }> = [];

  const service = createExecutionService(
    makeDependencies({
      findWorkflow: async () => invalidWorkflow,
      updateExecution: async (
        _tenant,
        _id,
        _expectedStatus,
        _expectedResults,
        update,
      ) => {
        updates.push(update as Record<string, unknown>);

        return {
          _id: executionId,
          tenantId,
          workflowId,
          workflowVersion: 3,
          graphSnapshot: invalidWorkflow.graph,
          ...update,
        };
      },
    }),
    undefined,
    (execution) => {
      notifications.push({
        status: execution.status,
        persistedWrites: updates.length,
      });
    },
  );

  const result = await service.startExecution(tenantId, String(workflowId));

  assert.equal(result.status, "failed");
  assert.deepEqual(notifications, [
    { status: "running", persistedWrites: 1 },
    { status: "failed", persistedWrites: 2 },
  ]);
});

test("does not notify a terminal state when the terminal write is unconfirmed", async () => {
  const graph = sagaWorkflow([{ nodeId: "task-a", actionId: "transform" }]);
  const actions: ActionRegistry = {
    taskActions: {
      transform: {
        execute: async () => ({ ok: true as const }),
      },
    },
  };
  let writes = 0;
  const notifications: string[] = [];

  const service = createExecutionService(
    makeDependencies({
      findWorkflow: async () => graph,
      actions,
      updateExecution: async (
        _tenant,
        _id,
        _expectedStatus,
        _expectedResults,
        update,
      ) => {
        writes += 1;

        // The running transition persists; the terminal write matches no record.
        if (writes > 1) {
          return null;
        }

        return {
          _id: executionId,
          tenantId,
          workflowId,
          workflowVersion: 3,
          graphSnapshot: graph.graph,
          ...update,
        };
      },
    }),
    actions,
    (execution) => {
      notifications.push(execution.status);
    },
  );

  await assert.rejects(
    () => service.startExecution(tenantId, String(workflowId)),
    (error: unknown) =>
      error instanceof ExecutionServiceError &&
      error.code === "EXECUTION_RESULT_PERSISTENCE_FAILED",
  );

  // No terminal notification may be published for an unconfirmed terminal state.
  assert.deepEqual(notifications, ["running"]);
});

test("keeps the execution outcome when the notifier throws", async () => {
  const graph = sagaWorkflow([{ nodeId: "task-a", actionId: "transform" }]);
  const updates: Array<{ expectedStatus: string; update: Record<string, unknown> }> = [];
  const actions: ActionRegistry = {
    taskActions: {
      transform: {
        execute: async () => ({ ok: true as const }),
      },
    },
  };

  const service = createExecutionService(
    sagaDependencies(graph, actions, updates),
    actions,
    () => {
      throw new Error("notification transport down");
    },
  );

  const result = await service.startExecution(tenantId, String(workflowId));

  assert.equal(result.status, "completed");
  assert.equal(updates.length, 2);
});

test("keeps retry and timeoutMs out of task and compensation payloads", async () => {
  const graph = sagaWorkflow([
    {
      nodeId: "task-a",
      actionId: "transform",
      compensationActionId: "undo",
      retry: { attempts: 3, backoffMs: 10 },
      timeoutMs: 10_000,
    },
    {
      nodeId: "task-b",
      actionId: "transform",
      retry: { attempts: 2, backoffMs: 5 },
      timeoutMs: 10_000,
    },
  ]);
  const taskInputs: Record<string, ValidatedActionInput> = {};
  const compensationInputs: Record<string, ValidatedActionInput> = {};
  const updates: Array<{ expectedStatus: string; update: Record<string, unknown> }> = [];

  const actions: ActionRegistry = {
    taskActions: {
      transform: {
        execute: async (input: ValidatedActionInput) => {
          const taskId = String(input.taskId);
          taskInputs[taskId] = input;

          if (taskId === "task-b") {
            return {
              ok: false as const,
              error: { code: "DOWNSTREAM_FAILED", message: "Downstream failed." },
            };
          }

          return { ok: true as const, output: { taskId } };
        },
      },
    },
    compensationActions: {
      undo: {
        execute: async (context) => {
          compensationInputs[context.nodeId] = context.taskConfig;
          return { ok: true as const };
        },
      },
    },
  };

  const service = createExecutionService(
    sagaDependencies(graph, actions, updates),
  );
  const result = await service.startExecution(tenantId, String(workflowId));

  assert.equal(result.status, "compensated");

  // Neither payload may carry orchestration-only controls.
  for (const payload of Object.values(taskInputs)) {
    assert.equal("retry" in payload, false);
    assert.equal("timeoutMs" in payload, false);
  }
  for (const payload of Object.values(compensationInputs)) {
    assert.equal("retry" in payload, false);
    assert.equal("timeoutMs" in payload, false);
  }

  assert.deepEqual(taskInputs["task-a"], {
    action: "transform",
    expression: "task-a",
    taskId: "task-a",
  });
  assert.deepEqual(compensationInputs["task-a"], {
    action: "transform",
    expression: "task-a",
    taskId: "task-a",
  });

  // Compensation still drives the persisted lifecycle; the payload change did
  // not alter it.
  assert.equal(updates[0].update.status, "running");
  assert.equal(updates[updates.length - 1].update.status, "compensated");
  assert.ok(updates.some((entry) => entry.update.status === "compensating"));
});
