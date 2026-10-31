import type { WorkflowGraph } from "../validators/workflow-graph.validator";
import { validateWorkflowGraph } from "../validators/workflow-graph.validator";

export type RuntimeNodeStatus = "completed" | "failed" | "skipped";

export type RegisteredActionIdentifier =
  | "http"
  | "sendEmail"
  | "sendSlack"
  | "dbQuery"
  | "transform";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type ValidatedActionInput = Readonly<Record<string, JsonValue>>;
export type CompensationActionIdentifier = string;

export interface StructuredActionError {
  code: string;
  message: string;
}

export type ActionResult =
  | { ok: true; output?: unknown }
  | { ok: false; error: StructuredActionError };

export interface RegisteredAction {
  execute(input: ValidatedActionInput): Promise<ActionResult>;
}

export interface CompensationContext {
  executionId: string;
  workflowId: string;
  nodeId: string;
  tenantId: string;
  taskAction: RegisteredActionIdentifier;
  taskConfig: ValidatedActionInput;
  compensationConfig: ValidatedActionInput;
  taskOutput: JsonValue | undefined;
}

export interface RegisteredCompensationAction {
  execute(context: CompensationContext): Promise<ActionResult>;
}

export interface RuntimeCompensationState {
  status: "pending" | "running" | "completed" | "failed";
  startedAt: Date | null;
  completedAt: Date | null;
  error: StructuredActionError | null;
}

export interface ActionRegistry {
  taskActions: Readonly<Record<string, RegisteredAction>>;
  compensationActions?: Readonly<Record<string, RegisteredCompensationAction>>;
}

export interface RuntimeExecutionContext {
  executionId: string;
  workflowId: string;
  tenantId: string;
}

export interface RuntimeExecutionCheckpoint {
  status: "compensating";
  stage: "pending" | "running" | "terminal";
  nodeId?: string;
  nodeResults: RuntimeNodeResult[];
  error: StructuredActionError;
}

export interface RuntimeNodeResult {
  nodeId: string;
  status: RuntimeNodeStatus;
  output?: unknown;
  error?: StructuredActionError;
  compensation?: RuntimeCompensationState;
}

export interface RuntimeExecutionResult {
  status: "completed" | "failed" | "compensated" | "compensation_failed";
  nodeResults: RuntimeNodeResult[];
  error?: StructuredActionError;
}

export interface WorkflowRuntime {
  execute(
    graph: WorkflowGraph,
    input: Record<string, unknown>,
    actions?: ActionRegistry,
    context?: RuntimeExecutionContext,
    onCheckpoint?: (checkpoint: RuntimeExecutionCheckpoint) => Promise<void>,
  ): Promise<RuntimeExecutionResult>;
}

const EMPTY_ACTION_REGISTRY: ActionRegistry = {
  taskActions: {},
  compensationActions: {},
};

type RuntimeGraphNode = WorkflowGraph["nodes"][number] & {
  data: WorkflowGraph["nodes"][number]["data"] & {
    conditionKey?: string;
  };
};

interface ParsedTaskActionConfig {
  actionId: RegisteredActionIdentifier;
  input: ValidatedActionInput;
  compensationAction?: CompensationActionIdentifier;
  compensationConfig?: ValidatedActionInput;
  timeoutMs?: number;
}

type TaskActionConfigResult =
  | { ok: true; value: ParsedTaskActionConfig }
  | { ok: false; error: StructuredActionError };

type JsonValidation =
  | { ok: true; value: JsonValue }
  | { ok: false };

function normalizeJsonValue(
  value: unknown,
  ancestors = new Set<object>(),
): JsonValidation {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return { ok: true, value };
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  }

  if (typeof value !== "object" || ancestors.has(value)) {
    return { ok: false };
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (
        keys.some(
          (key) =>
            key !== "length" &&
            (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)),
        )
      ) {
        return { ok: false };
      }

      const normalized: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          return { ok: false };
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          return { ok: false };
        }
        const item = normalizeJsonValue(descriptor.value, ancestors);
        if (!item.ok) {
          return { ok: false };
        }
        normalized.push(item.value);
      }
      return { ok: true, value: normalized };
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return { ok: false };
    }

    const normalized: Record<string, JsonValue> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        return { ok: false };
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return { ok: false };
      }
      const item = normalizeJsonValue(descriptor.value, ancestors);
      if (!item.ok) {
        return { ok: false };
      }
      Object.defineProperty(normalized, key, {
        value: item.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return { ok: true, value: normalized };
  } finally {
    ancestors.delete(value);
  }
}

function safelyNormalizeJsonValue(value: unknown): JsonValidation {
  try {
    return normalizeJsonValue(value);
  } catch {
    return { ok: false };
  }
}

function parseTaskActionConfig(value: unknown): TaskActionConfigResult {
  const normalized = safelyNormalizeJsonValue(value);
  if (!normalized.ok || !isRecord(normalized.value)) {
    return {
      ok: false,
      error: {
        code: "INVALID_ACTION_CONFIG",
        message: "The task action configuration is invalid.",
      },
    };
  }

  const config = normalized.value;
  if ("compensation" in config) {
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_COMPENSATION_CONFIG",
        message:
          "Use compensationAction and compensationConfig for Saga v1 compensation.",
      },
    };
  }

  const actionId = config.action;
  const invalidConfig = (): TaskActionConfigResult => ({
    ok: false,
    error: {
      code: "INVALID_ACTION_CONFIG",
      message: "The task action configuration is invalid.",
    },
  });
  if (typeof actionId !== "string") {
    return invalidConfig();
  }
  if (
    !["http", "sendEmail", "sendSlack", "dbQuery", "transform"].includes(
      actionId,
    )
  ) {
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_TASK_ACTION",
        message: "The task action is not supported.",
      },
    };
  }

  const isString = (field: string): boolean =>
    typeof config[field] === "string" && Boolean(config[field]);
  // A timeout must be a positive, finite millisecond value. Zero and negative
  // values would fire before a handler could do anything, so they are rejected
  // rather than silently reinterpreted as "no timeout" or "timed out at once".
  const timeoutValid =
    config.timeoutMs === undefined ||
    (typeof config.timeoutMs === "number" &&
      Number.isFinite(config.timeoutMs) &&
      config.timeoutMs > 0);
  const valid =
    timeoutValid &&
    ((actionId === "http" &&
      ["GET", "POST", "PUT", "DELETE", "PATCH"].includes(
        String(config.method),
      ) &&
      isString("url") &&
      (config.headers === undefined ||
        (isRecord(config.headers) &&
          Object.values(config.headers).every(
            (header) => typeof header === "string",
          )))) ||
    (actionId === "sendEmail" &&
      isString("to") &&
      isString("subject") &&
      isString("body") &&
      (config.cc === undefined ||
        (Array.isArray(config.cc) &&
          config.cc.every((address) => typeof address === "string")))) ||
    (actionId === "sendSlack" &&
      isString("channel") &&
      isString("message") &&
      (config.asUser === undefined || typeof config.asUser === "string")) ||
    (actionId === "dbQuery" &&
      isString("connection") &&
      isString("query") &&
      (config.params === undefined || Array.isArray(config.params))) ||
    (actionId === "transform" && isString("expression")));

  if (!valid) {
    return invalidConfig();
  }

  // `retry` is validated but not executed (decision D1, 30 Oct 2026). Only the
  // shape is checked here; the attempt cap and backoff policy belong to the
  // future implementation, so an oversized `attempts` is not rejected today.
  const retry = config.retry;
  const retryValid =
    retry === undefined ||
    (isRecord(retry) &&
      typeof retry.attempts === "number" &&
      Number.isInteger(retry.attempts) &&
      retry.attempts >= 1 &&
      typeof retry.backoffMs === "number" &&
      Number.isFinite(retry.backoffMs) &&
      retry.backoffMs >= 0);
  if (!retryValid) {
    return {
      ok: false,
      error: {
        code: "INVALID_RETRY_CONFIG",
        message:
          "The task retry configuration is invalid: attempts must be an integer of at least 1 and backoffMs a non-negative number.",
      },
    };
  }

  const compensationAction = config.compensationAction;
  const compensationConfig = config.compensationConfig;
  if (compensationAction === undefined && compensationConfig !== undefined) {
    return {
      ok: false,
      error: {
        code: "INVALID_COMPENSATION_CONFIG",
        message: "compensationConfig requires a compensationAction.",
      },
    };
  }
  if (
    compensationAction !== undefined &&
    (typeof compensationAction !== "string" ||
      !compensationAction.trim() ||
      (compensationConfig !== undefined && !isRecord(compensationConfig)))
  ) {
    return {
      ok: false,
      error: {
        code: "INVALID_COMPENSATION_CONFIG",
        message: "The task compensation configuration is invalid.",
      },
    };
  }

  // Orchestration-only fields stay out of the handler payload (decision D1).
  // A handler that forwards its input must never transmit a retry policy or a
  // runtime timeout to an external service. `timeoutMs` still bounds the wait;
  // it is read from the parsed config, not from the handler input.
  const taskConfig = { ...config };
  delete taskConfig.compensationAction;
  delete taskConfig.compensationConfig;
  delete taskConfig.retry;
  delete taskConfig.timeoutMs;

  return {
    ok: true,
    value: {
      actionId: actionId as RegisteredActionIdentifier,
      input: taskConfig as ValidatedActionInput,
      compensationAction:
        typeof compensationAction === "string"
          ? compensationAction
          : undefined,
      compensationConfig: isRecord(compensationConfig)
        ? (compensationConfig as ValidatedActionInput)
        : compensationAction
          ? {}
          : undefined,
      timeoutMs:
        typeof config.timeoutMs === "number" ? config.timeoutMs : undefined,
    },
  };
}

const ACTION_HANDLER_FAILED_ERROR: StructuredActionError = {
  code: "ACTION_HANDLER_FAILED",
  message: "The registered action failed unexpectedly.",
};

const ACTION_TIMEOUT_ERROR: StructuredActionError = {
  code: "ACTION_TIMEOUT",
  message: "The task action exceeded its configured timeout.",
};

/**
 * Stops *waiting* for a handler. It does not stop the handler.
 *
 * A resolved timeout only tells the runtime to treat the step as failed. The
 * underlying action keeps running, may still perform external side effects, and
 * its eventual result is discarded. Because the node is recorded as `failed`,
 * those late side effects are never compensated. This is a known limitation of
 * a Promise-level timeout and must not be reported as cancellation.
 */
function withTimeout(
  pending: Promise<ActionResult>,
  timeoutMs: number,
): Promise<ActionResult> {
  return new Promise<ActionResult>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: ActionResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resolve(result);
    };

    timer = setTimeout(
      () => finish({ ok: false, error: ACTION_TIMEOUT_ERROR }),
      timeoutMs,
    );

    pending.then(finish, () =>
      finish({ ok: false, error: ACTION_HANDLER_FAILED_ERROR }),
    );
  });
}

async function invokeAction(
  action: RegisteredAction,
  input: ValidatedActionInput,
  timeoutMs?: number,
): Promise<ActionResult> {
  try {
    const pending = action.execute(input);
    if (timeoutMs === undefined) {
      return await pending;
    }
    return await withTimeout(pending, timeoutMs);
  } catch {
    return {
      ok: false,
      error: ACTION_HANDLER_FAILED_ERROR,
    };
  }
}

async function invokeCompensation(
  action: RegisteredCompensationAction,
  context: CompensationContext,
): Promise<ActionResult> {
  try {
    return await action.execute(context);
  } catch {
    return {
      ok: false,
      error: {
        code: "COMPENSATION_HANDLER_FAILED",
        message: "The registered compensation handler failed unexpectedly.",
      },
    };
  }
}

type ConditionEvaluation =
  | { ok: true; value: boolean }
  | { ok: false; code: string; message: string };

const CONDITION_OPERATORS = new Set([
  "equals",
  "notEquals",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "startsWith",
  "matches",
  "truthy",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveInputPath(
  input: Record<string, unknown>,
  path: string,
): { ok: true; value: unknown } | { ok: false; code: string; message: string } {
  const segments = path.split(".");

  if (
    !path.trim() ||
    path.startsWith("input.") ||
    path === "input" ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "__proto__" ||
        segment === "prototype" ||
        segment === "constructor",
    )
  ) {
    return {
      ok: false,
      code: "INVALID_CONDITION_PATH",
      message: "The condition input path is invalid.",
    };
  }

  let value: unknown = input;

  for (const segment of segments) {
    if (
      !isRecord(value) ||
      !Object.prototype.hasOwnProperty.call(value, segment)
    ) {
      return {
        ok: false,
        code: "CONDITION_INPUT_MISSING",
        message: "A required condition input is missing.",
      };
    }

    value = value[segment];
  }

  if (value === undefined) {
    return {
      ok: false,
      code: "CONDITION_INPUT_MISSING",
      message: "A required condition input is missing.",
    };
  }

  return { ok: true, value };
}

function evaluateCondition(
  config: unknown,
  input: Record<string, unknown>,
): ConditionEvaluation {
  if (!isRecord(config)) {
    return {
      ok: false,
      code: "CONDITION_NOT_CONFIGURED",
      message: "The condition node has no valid configuration.",
    };
  }

  if (config.type !== "clause") {
    return {
      ok: false,
      code: "UNSUPPORTED_CONDITION_CONFIG",
      message: "This condition configuration is not supported yet.",
    };
  }

  if (
    !isRecord(config.clause) ||
    typeof config.clause.left !== "string" ||
    typeof config.clause.op !== "string" ||
    !CONDITION_OPERATORS.has(config.clause.op)
  ) {
    return {
      ok: false,
      code: "INVALID_CONDITION_CONFIG",
      message: "The condition clause is invalid.",
    };
  }

  const { left, op, right } = config.clause;

  if (op === "matches") {
    return {
      ok: false,
      code: "UNSUPPORTED_CONDITION_OPERATOR",
      message: "The matches operator is not supported yet.",
    };
  }

  if (
    op !== "truthy" &&
    !Object.prototype.hasOwnProperty.call(config.clause, "right")
  ) {
    return {
      ok: false,
      code: "INVALID_CONDITION_CONFIG",
      message: "This condition operator requires a right-hand value.",
    };
  }

  const resolved = resolveInputPath(input, left);

  if (!resolved.ok) {
    return resolved;
  }

  const value = resolved.value;

  switch (op) {
    case "truthy":
      return { ok: true, value: Boolean(value) };

    case "equals":
      return { ok: true, value: value === right };

    case "notEquals":
      return { ok: true, value: value !== right };

    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        typeof right !== "number" ||
        !Number.isFinite(right)
      ) {
        return {
          ok: false,
          code: "INVALID_CONDITION_OPERANDS",
          message: "Numeric comparisons require finite numbers.",
        };
      }

      if (op === "gt") return { ok: true, value: value > right };
      if (op === "gte") return { ok: true, value: value >= right };
      if (op === "lt") return { ok: true, value: value < right };
      return { ok: true, value: value <= right };
    }

    case "startsWith":
      if (typeof value !== "string" || typeof right !== "string") {
        return {
          ok: false,
          code: "INVALID_CONDITION_OPERANDS",
          message: "startsWith requires string operands.",
        };
      }
      return { ok: true, value: value.startsWith(right) };

    case "contains":
      if (typeof value === "string" && typeof right === "string") {
        return { ok: true, value: value.includes(right) };
      }

      if (Array.isArray(value)) {
        return { ok: true, value: value.some((item) => item === right) };
      }

      return {
        ok: false,
        code: "INVALID_CONDITION_OPERANDS",
        message: "contains requires a string or array input.",
      };

    default:
      return {
        ok: false,
        code: "UNSUPPORTED_CONDITION_OPERATOR",
        message: "The condition operator is not supported.",
      };
  }
}


function failure(
  code: string,
  message: string,
  nodeResults: RuntimeNodeResult[] = [],
): RuntimeExecutionResult {
  return {
    status: "failed",
    nodeResults,
    error: { code, message },
  };
}


export async function executeWorkflowGraph(
  graph: WorkflowGraph,
  input: Record<string, unknown>,
  actions: ActionRegistry = EMPTY_ACTION_REGISTRY,
  executionContext?: RuntimeExecutionContext,
  onCheckpoint?: (checkpoint: RuntimeExecutionCheckpoint) => Promise<void>,
): Promise<RuntimeExecutionResult> {
  try {
    const validation = validateWorkflowGraph(graph);

    if (validation.length > 0) {
      return failure("INVALID_GRAPH", "The workflow graph is invalid.");
    }
  } catch {
    return failure("INVALID_GRAPH", "The workflow graph is invalid.");
  }

  const nodes = graph.nodes as RuntimeGraphNode[];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = graph.edges;
  const compensationActions = actions.compensationActions ?? {};
  const nodeResults: RuntimeNodeResult[] = [];
  const visited = new Set<string>();
  const compensationByNodeId = new Map<
    string,
    {
      actionId: CompensationActionIdentifier;
      context: Omit<CompensationContext, "executionId" | "workflowId" | "nodeId" | "tenantId" | "taskOutput">;
      taskOutput: JsonValue | undefined;
    }
  >();

  const trigger = nodes.find((node) => node.type === "trigger");

  if (!trigger) {
    return failure("INVALID_GRAPH", "The workflow has no trigger node.");
  }

  let current: RuntimeGraphNode | undefined = trigger;

  const fail = async (
    error: StructuredActionError,
  ): Promise<RuntimeExecutionResult> => {
    const eligibleNodes = nodeResults
      .filter(
        (node) =>
          node.status === "completed" &&
          compensationByNodeId.has(node.nodeId),
      )
      .reverse();

    if (eligibleNodes.length === 0) {
      return { status: "failed", nodeResults, error };
    }

    if (!executionContext || !onCheckpoint) {
      throw new Error(
        "Compensation requires execution context and a persistence checkpoint.",
      );
    }

    for (const node of eligibleNodes) {
      node.compensation = {
        status: "pending",
        startedAt: null,
        completedAt: null,
        error: null,
      };
    }
    await onCheckpoint({
      status: "compensating",
      stage: "pending",
      nodeResults: structuredClone(nodeResults),
      error,
    });

    let compensationFailed = false;
    for (const node of eligibleNodes) {
      const compensation = compensationByNodeId.get(node.nodeId)!;
      node.compensation = {
        status: "running",
        startedAt: new Date(),
        completedAt: null,
        error: null,
      };
      await onCheckpoint({
        status: "compensating",
        stage: "running",
        nodeId: node.nodeId,
        nodeResults: structuredClone(nodeResults),
        error,
      });

      const handler = compensationActions[compensation.actionId];
      const actionResult = handler
        ? await invokeCompensation(handler, {
            ...executionContext,
            nodeId: node.nodeId,
            ...compensation.context,
            taskOutput: compensation.taskOutput,
          })
        : {
            ok: false as const,
            error: {
              code: "COMPENSATION_ACTION_NOT_REGISTERED",
              message: "The compensation action is not registered.",
            },
          };
      const terminalState: RuntimeCompensationState = {
        status: actionResult.ok ? "completed" : "failed",
        startedAt: node.compensation.startedAt,
        completedAt: new Date(),
        error: actionResult.ok ? null : actionResult.error,
      };
      compensationFailed ||= !actionResult.ok;
      node.compensation = terminalState;
      await onCheckpoint({
        status: "compensating",
        stage: "terminal",
        nodeId: node.nodeId,
        nodeResults: structuredClone(nodeResults),
        error,
      });
    }

    return {
      status: compensationFailed ? "compensation_failed" : "compensated",
      nodeResults,
      error,
    };
  };

  while (current) {
    if (visited.has(current.id)) {
      return fail({
        code: "CYCLE_DETECTED",
        message: "The workflow cannot revisit a node.",
      });
    }

    visited.add(current.id);

    if (visited.size > nodes.length) {
      return fail({
        code: "EXECUTION_LIMIT",
        message: "The workflow exceeded its execution limit.",
      });
    }

    // Evaluate configured conditions and follow the matching branch.
    if (current.type === "condition") {
      const evaluation = evaluateCondition(current.data.config, input);

      if (!evaluation.ok) {
        nodeResults.push({
          nodeId: current.id,
          status: "failed",
          error: {
            code: evaluation.code,
            message: evaluation.message,
          },
        });
        return fail({ code: evaluation.code, message: evaluation.message });
      }

      const expectedHandle = evaluation.value ? "true" : "false";
      const matchingEdges = edges.filter(
        (edge) =>
          edge.source === current!.id && edge.sourceHandle === expectedHandle,
      );

      if (matchingEdges.length !== 1) {
        nodeResults.push({
          nodeId: current.id,
          status: "failed",
          error: {
            code: "INVALID_CONDITION_BRANCH",
            message: "The selected condition branch is invalid.",
          },
        });
        return fail({
          code: "INVALID_CONDITION_BRANCH",
          message:
            "The condition must have exactly one edge for the selected branch.",
        });
      }

      nodeResults.push({
        nodeId: current.id,
        status: "completed",
        output: { result: evaluation.value },
      });

      const nextNode = nodeById.get(matchingEdges[0].target);

      if (!nextNode) {
        return fail({
          code: "INVALID_EDGE_TARGET",
          message: "An edge points to a node that does not exist.",
        });
      }

      current = nextNode;
      continue;
    }

    if (current.type === "task" && current.data.config !== undefined) {
      const parsedConfig = parseTaskActionConfig(current.data.config);

      if (!parsedConfig.ok) {
        nodeResults.push({
          nodeId: current.id,
          status: "failed",
          error: parsedConfig.error,
        });
        return fail(parsedConfig.error);
      }

      const taskAction = parsedConfig.value;
      const handler = Object.hasOwn(actions.taskActions, taskAction.actionId)
        ? actions.taskActions[taskAction.actionId]
        : undefined;

      if (!handler) {
        const error = {
          code: "ACTION_NOT_REGISTERED",
          message: "The task action is not registered.",
        };
        nodeResults.push({ nodeId: current.id, status: "failed", error });
        return fail(error);
      }

      if (
        taskAction.compensationAction &&
        !Object.hasOwn(
          compensationActions,
          taskAction.compensationAction,
        )
      ) {
        const error = {
          code: "COMPENSATION_ACTION_NOT_REGISTERED",
          message: "The task compensation action is not registered.",
        };
        nodeResults.push({ nodeId: current.id, status: "failed", error });
        return fail(error);
      }

      const result = await invokeAction(
        handler,
        taskAction.input,
        taskAction.timeoutMs,
      );
      if (!result.ok) {
        nodeResults.push({
          nodeId: current.id,
          status: "failed",
          error: result.error,
        });
        return fail(result.error);
      }

      const nodeResult: RuntimeNodeResult = {
        nodeId: current.id,
        status: "completed",
      };
      nodeResults.push(nodeResult);
      if (
        taskAction.compensationAction &&
        taskAction.compensationConfig
      ) {
        compensationByNodeId.set(current.id, {
          actionId: taskAction.compensationAction,
          context: {
            taskAction: taskAction.actionId,
            taskConfig: taskAction.input,
            compensationConfig: taskAction.compensationConfig,
          },
          taskOutput: undefined,
        });
      }
      if (Object.hasOwn(result, "output")) {
        const output = safelyNormalizeJsonValue(result.output);
        if (!output.ok) {
          nodeResult.error = {
            code: "INVALID_ACTION_OUTPUT",
            message:
              "The action succeeded but returned output outside the JSON value contract.",
          };
          return fail(nodeResult.error);
        }
        nodeResult.output = output.value;
        const compensation = compensationByNodeId.get(current.id);
        if (compensation) {
          compensation.taskOutput = output.value;
        }
      }
    } else {
      // Unconfigured tasks retain their existing traversal-only behavior.
      nodeResults.push({
        nodeId: current.id,
        status: "completed",
      });
    }

    const outgoingEdges = edges.filter((edge) => edge.source === current!.id);

    if (outgoingEdges.length === 0) {
      current = undefined;
      continue;
    }

    if (outgoingEdges.length !== 1) {
      return fail({
        code: "AMBIGUOUS_BRANCH",
        message: "A non-condition node must have at most one outgoing edge.",
      });
    }

    const nextNode = nodeById.get(outgoingEdges[0].target);

    if (!nextNode) {
      return fail({
        code: "INVALID_EDGE_TARGET",
        message: "An edge points to a node that does not exist.",
      });
    }

    current = nextNode;
  }

  return {
    status: "completed",
    nodeResults,
  };
}
