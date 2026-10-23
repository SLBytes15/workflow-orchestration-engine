import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executeWorkflowGraph,
  type ActionRegistry,
} from "./execution.runtime";
import type { WorkflowGraph } from "../validators/workflow-graph.validator";

function createGraph(): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 0, y: 0 },
        data: {
          type: "trigger",
          label: "Order Created?",
          config: {
            type: "clause",
            clause: {
              left: "approved",
              op: "equals",
              right: true,
            },
          },
        },
      },
      {
        id: "condition-1",
        type: "condition",
        position: { x: 100, y: 0 },
        data: {
          type: "condition",
          label: "Payment approved?",
          config: {
            type: "clause",
            clause: {
              left: "approved",
              op: "equals",
              right: true,
            },
          },
        },
      },
      {
        id: "task-true",
        type: "task",
        position: { x: 200, y: -50 },
        data: { type: "task", label: "Confirm order" },
      },
      {
        id: "task-false",
        type: "task",
        position: { x: 200, y: 50 },
        data: { type: "task", label: "Reject order" },
      },
    ],
    edges: [
      {
        id: "edge-1",
        source: "trigger-1",
        target: "condition-1",
      },
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
  };
}

describe("executeWorkflowGraph", () => {
  it("executes the true branch when the condition input is true", async () => {
    const graph = createGraph();

    const result = await executeWorkflowGraph(graph, {
      approved: true,
    });

    assert.equal(result.status, "completed");

    const completedNodeIds = result.nodeResults
      .filter((node) => node.status === "completed")
      .map((node) => node.nodeId);

    assert.deepEqual(completedNodeIds, [
      "trigger-1",
      "condition-1",
      "task-true",
    ]);

    assert.equal(completedNodeIds.includes("task-false"), false);
  });

  it("executes the false branch when the condition input is false", async () => {
    const graph = createGraph();

    const result = await executeWorkflowGraph(graph, {
      approved: false,
    });

    assert.equal(result.status, "completed");

    const completedNodeIds = result.nodeResults
      .filter((node) => node.status === "completed")
      .map((node) => node.nodeId);

    assert.deepEqual(completedNodeIds, [
      "trigger-1",
      "condition-1",
      "task-false",
    ]);

    assert.equal(completedNodeIds.includes("task-true"), false);
  });

  it("fails when the required condition input is missing", async () => {
    const graph = createGraph();

    const result = await executeWorkflowGraph(graph, {});

    assert.equal(result.status, "failed");
    assert.ok(result.error);
    assert.equal(
      result.nodeResults.some(
        (node) => node.nodeId === "task-true" || node.nodeId === "task-false",
      ),
      false,
    );
  });

  
it("fails when numeric comparison operands are invalid", async () => {
  const graph = createGraph();

  const conditionNode = graph.nodes.find((node) => node.id === "condition-1");

  assert.ok(conditionNode);

  conditionNode.data.config = {
    type: "clause",
    clause: {
      left: "approved",
      op: "gt",
      right: 10,
    },
  };

  const result = await executeWorkflowGraph(graph, {
    approved: "yes",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "INVALID_CONDITION_OPERANDS");
});


  it("does not mutate the original graph", async () => {
    const graph = createGraph();
    const originalGraph = structuredClone(graph);

    await executeWorkflowGraph(graph, { approved: true });

    assert.deepEqual(graph, originalGraph);
  });

  it("rejects task action identifiers that are not registered", async () => {
    const graph = createGraph();
    const task = graph.nodes.find((node) => node.id === "task-true");
    assert.ok(task);
    task.data.config = {
      action: "unsupportedAction",
    };

    const actions: ActionRegistry = {
      taskActions: {},
    };
    const result = await executeWorkflowGraph(
      graph,
      { approved: true },
      actions,
    );

    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "UNSUPPORTED_TASK_ACTION");
    assert.equal(
      result.nodeResults.find((node) => node.nodeId === "task-true")?.status,
      "failed",
    );
  });

  it("maps the documented action field and preserves action-specific config", async () => {
    const graph = createGraph();
    const task = graph.nodes.find((node) => node.id === "task-true");
    assert.ok(task);
    task.data.config = {
      action: "sendEmail",
      to: "ops@example.test",
      subject: "Order",
      body: "Created",
      cc: ["audit@example.test"],
    };
    let receivedInput: unknown;
    const result = await executeWorkflowGraph(
      graph,
      { approved: true },
      {
        taskActions: {
          sendEmail: {
            execute: async (input) => {
              receivedInput = input;
              return { ok: true };
            },
          },
        },
      },
    );

    assert.equal(result.status, "completed");
    assert.deepEqual(receivedInput, task.data.config);
  });

  it("fails safely for an unsupported action identifier", async () => {
    const graph = createGraph();
    const task = graph.nodes.find((node) => node.id === "task-true");
    assert.ok(task);
    task.data.config = { action: "unknownAction" };

    const result = await executeWorkflowGraph(graph, { approved: true });

    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "UNSUPPORTED_TASK_ACTION");
  });

  it("fails safely when a supported action has no registered handler", async () => {
    const graph = createGraph();
    const task = graph.nodes.find((node) => node.id === "task-true");
    assert.ok(task);
    task.data.config = {
      action: "http",
      method: "GET",
      url: "https://example.test",
    };

    const result = await executeWorkflowGraph(graph, { approved: true });

    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "ACTION_NOT_REGISTERED");
  });

  it("rejects invalid action-specific input before dispatch", async () => {
    const graph = createGraph();
    const task = graph.nodes.find((node) => node.id === "task-true");
    assert.ok(task);
    task.data.config = {
      action: "http",
      method: "GET",
      url: { invalid: true },
    };
    let called = false;

    const result = await executeWorkflowGraph(graph, { approved: true }, {
      taskActions: {
        http: {
          execute: async () => {
            called = true;
            return { ok: true };
          },
        },
      },
    });

    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "INVALID_ACTION_CONFIG");
    assert.equal(called, false);
  });

  it("rejects an unapproved compensation field without invoking any handler", async () => {
    const graph = createGraph();
    const task = graph.nodes.find((node) => node.id === "task-true");
    assert.ok(task);
    task.data.config = {
      action: "http",
      method: "POST",
      url: "https://example.test",
      compensation: {
        action: "http",
        method: "DELETE",
        url: "https://example.test",
      },
    };
    let called = false;

    const result = await executeWorkflowGraph(graph, { approved: true }, {
      taskActions: {
        http: {
          execute: async () => {
            called = true;
            return { ok: true };
          },
        },
      },
    });

    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "UNSUPPORTED_COMPENSATION_CONFIG");
    assert.equal(called, false);
  });

  it("rejects an unknown compensation action before dispatching its task", async () => {
    const graph = createGraph();
    const task = graph.nodes.find((node) => node.id === "task-true");
    assert.ok(task);
    task.data.config = {
      action: "transform",
      expression: "run",
      compensationAction: "unknown-compensation",
      compensationConfig: { taskId: "task-true" },
    };
    let taskCalled = false;

    const result = await executeWorkflowGraph(graph, { approved: true }, {
      taskActions: {
        transform: {
          execute: async () => {
            taskCalled = true;
            return { ok: true };
          },
        },
      },
    });

    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "COMPENSATION_ACTION_NOT_REGISTERED");
    assert.equal(taskCalled, false);
  });

  it("rejects invalid compensation config before task dispatch", async () => {
    const graph = createGraph();
    const task = graph.nodes.find((node) => node.id === "task-true");
    assert.ok(task);
    task.data.config = {
      action: "transform",
      expression: "run",
      compensationAction: "undo",
      compensationConfig: ["not-an-object"],
    };
    let taskCalled = false;

    const result = await executeWorkflowGraph(graph, { approved: true }, {
      taskActions: {
        transform: {
          execute: async () => {
            taskCalled = true;
            return { ok: true };
          },
        },
      },
      compensationActions: {
        undo: { execute: async () => ({ ok: true }) },
      },
    });

    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "INVALID_COMPENSATION_CONFIG");
    assert.equal(taskCalled, false);
  });

  it("accepts an omitted compensation config as an empty object", async () => {
    const graph = createGraph();
    const task = graph.nodes.find((node) => node.id === "task-true");
    assert.ok(task);
    task.data.config = {
      action: "transform",
      expression: "run",
      compensationAction: "undo",
    };
    graph.nodes.push({
      id: "task-b",
      type: "task",
      position: { x: 300, y: 0 },
      data: { type: "task", label: "Fail", config: { action: "transform", expression: "fail" } },
    });
    graph.edges.push({
      id: "edge-task-b",
      source: "task-true",
      target: "task-b",
    });
    const result = await executeWorkflowGraph(
      graph,
      { approved: true },
      {
        taskActions: {
          transform: {
            execute: async (input) =>
              input.expression === "fail"
                ? {
                    ok: false as const,
                    error: { code: "TASK_FAILED", message: "Task failed." },
                  }
                : { ok: true as const },
          },
        },
        compensationActions: {
          undo: {
            execute: async (context) => {
              assert.deepEqual(context.compensationConfig, {});
              return { ok: true };
            },
          },
        },
      },
      {
        executionId: "execution-id",
        workflowId: "workflow-id",
        tenantId: "tenant-id",
      },
      async () => undefined,
    );

    assert.equal(result.status, "compensated");
  });

  it("persists valid nested JSON-compatible action output", async () => {
    const graph = createGraph();
    const task = graph.nodes.find((node) => node.id === "task-true");
    assert.ok(task);
    task.data.config = {
      action: "transform",
      expression: "validated-by-the-registered-handler",
    };
    const output = {
      order: { id: "order-1", lines: [{ sku: "sku-1", quantity: 2 }] },
      accepted: true,
      metadata: null,
    };

    const result = await executeWorkflowGraph(graph, { approved: true }, {
      taskActions: {
        transform: { execute: async () => ({ ok: true, output }) },
      },
    });

    assert.equal(result.status, "completed");
    assert.deepEqual(
      result.nodeResults.find((node) => node.nodeId === "task-true")?.output,
      output,
    );
    assert.notEqual(
      result.nodeResults.find((node) => node.nodeId === "task-true")?.output,
      output,
    );
  });

  it("rejects invalid JSON output without losing a successful side effect", async () => {
    const graph = createGraph();
    const task = graph.nodes.find((node) => node.id === "task-true");
    assert.ok(task);
    task.data.config = {
      action: "transform",
      expression: "handler-produced-output",
    };
    let sideEffectCompleted = false;
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    const result = await executeWorkflowGraph(graph, { approved: true }, {
      taskActions: {
        transform: {
          execute: async () => {
            sideEffectCompleted = true;
            return { ok: true, output: cyclic };
          },
        },
      },
    });

    assert.equal(sideEffectCompleted, true);
    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "INVALID_ACTION_OUTPUT");
    const taskResult = result.nodeResults.find(
      (node) => node.nodeId === "task-true",
    );
    assert.equal(taskResult?.status, "completed");
    assert.equal(taskResult?.error?.code, "INVALID_ACTION_OUTPUT");
    assert.equal(taskResult?.output, undefined);
  });

  it("rejects non-finite numbers, functions, undefined, and non-plain output objects", async () => {
    const outputs: unknown[] = [
      Number.POSITIVE_INFINITY,
      () => undefined,
      { value: undefined },
      new Date(),
    ];

    for (const output of outputs) {
      const graph = createGraph();
      const task = graph.nodes.find((node) => node.id === "task-true");
      assert.ok(task);
      task.data.config = { action: "transform", expression: "test" };
      const result = await executeWorkflowGraph(graph, { approved: true }, {
        taskActions: {
          transform: { execute: async () => ({ ok: true, output }) },
        },
      });
      assert.equal(result.error?.code, "INVALID_ACTION_OUTPUT");
    }
  });

  it("converts a thrown task handler exception into a structured failure", async () => {
    const graph = createGraph();
    const task = graph.nodes.find((node) => node.id === "task-true");
    assert.ok(task);
    task.data.config = { action: "transform", expression: "throws" };

    const result = await executeWorkflowGraph(graph, { approved: true }, {
      taskActions: {
        transform: {
          execute: async () => {
            throw new Error("private handler detail");
          },
        },
      },
    });

    assert.equal(result.status, "failed");
    assert.deepEqual(result.error, {
      code: "ACTION_HANDLER_FAILED",
      message: "The registered action failed unexpectedly.",
    });
    assert.equal(JSON.stringify(result).includes("private handler detail"), false);
  });
});
