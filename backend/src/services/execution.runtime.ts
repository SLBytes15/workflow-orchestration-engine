import type { WorkflowGraph } from "../validators/workflow-graph.validator";
import { validateWorkflowGraph } from "../validators/workflow-graph.validator";

export type RuntimeNodeStatus = "completed" | "failed" | "skipped";

export interface RuntimeNodeResult {
  nodeId: string;
  status: RuntimeNodeStatus;
  output?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export interface RuntimeExecutionResult {
  status: "completed" | "failed";
  nodeResults: RuntimeNodeResult[];
  error?: {
    code: string;
    message: string;
  };
}

export interface WorkflowRuntime {
  execute(graph: WorkflowGraph): Promise<RuntimeExecutionResult>;
}

type RuntimeGraphNode = WorkflowGraph["nodes"][number] & {
  data: WorkflowGraph["nodes"][number]["data"] & {
    conditionKey?: string;
  };
};


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
  const nodeResults: RuntimeNodeResult[] = [];
  const visited = new Set<string>();

  const trigger = nodes.find((node) => node.type === "trigger");

  if (!trigger) {
    return failure("INVALID_GRAPH", "The workflow has no trigger node.");
  }

  let current: RuntimeGraphNode | undefined = trigger;

  while (current) {
    if (visited.has(current.id)) {
      return failure(
        "CYCLE_DETECTED",
        "The workflow cannot revisit a node.",
        nodeResults,
      );
    }

    visited.add(current.id);

    if (visited.size > nodes.length) {
      return failure(
        "EXECUTION_LIMIT",
        "The workflow exceeded its execution limit.",
        nodeResults,
      );
    }

    // Evaluate configured conditions and follow the matching branch.
    if (current.type === "condition") {
      const evaluation = evaluateCondition(current.data.config, input);

      if (!evaluation.ok) {
        return failure(evaluation.code, evaluation.message, [
          ...nodeResults,
          {
            nodeId: current.id,
            status: "failed",
            error: {
              code: evaluation.code,
              message: evaluation.message,
            },
          },
        ]);
      }

      const expectedHandle = evaluation.value ? "true" : "false";
      const matchingEdges = edges.filter(
        (edge) =>
          edge.source === current!.id && edge.sourceHandle === expectedHandle,
      );

      if (matchingEdges.length !== 1) {
        return failure(
          "INVALID_CONDITION_BRANCH",
          "The condition must have exactly one edge for the selected branch.",
          [
            ...nodeResults,
            {
              nodeId: current.id,
              status: "failed",
              error: {
                code: "INVALID_CONDITION_BRANCH",
                message: "The selected condition branch is invalid.",
              },
            },
          ],
        );
      }

      nodeResults.push({
        nodeId: current.id,
        status: "completed",
        output: { result: evaluation.value },
      });

      const nextNode = nodeById.get(matchingEdges[0].target);

      if (!nextNode) {
        return failure(
          "INVALID_EDGE_TARGET",
          "An edge points to a node that does not exist.",
          nodeResults,
        );
      }

      current = nextNode;
      continue;
    }

    // Trigger and task nodes currently act as traversal steps.
    nodeResults.push({
      nodeId: current.id,
      status: "completed",
    });

    const outgoingEdges = edges.filter((edge) => edge.source === current!.id);

    if (outgoingEdges.length === 0) {
      current = undefined;
      continue;
    }

    if (outgoingEdges.length !== 1) {
      return failure(
        "AMBIGUOUS_BRANCH",
        "A non-condition node must have at most one outgoing edge.",
        nodeResults,
      );
    }

    const nextNode = nodeById.get(outgoingEdges[0].target);

    if (!nextNode) {
      return failure(
        "INVALID_EDGE_TARGET",
        "An edge points to a node that does not exist.",
        nodeResults,
      );
    }

    current = nextNode;
  }

  return {
    status: "completed",
    nodeResults,
  };
}

