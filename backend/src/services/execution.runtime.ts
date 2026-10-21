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

    // A defensive limit prevents unexpectedly long traversals.
    if (visited.size > nodes.length) {
      return failure(
        "EXECUTION_LIMIT",
        "The workflow exceeded its execution limit.",
        nodeResults,
      );
    }

    if (current.type === "condition") {
      const conditionKey = current.data.conditionKey;

      if (!conditionKey) {
        return failure(
          "CONDITION_NOT_CONFIGURED",
          "The condition node has no configured input key.",
          nodeResults,
        );
      }

      if (!Object.prototype.hasOwnProperty.call(input, conditionKey)) {
        return failure(
          "CONDITION_INPUT_MISSING",
          "A required condition input is missing.",
          [
            ...nodeResults,
            {
              nodeId: current.id,
              status: "failed",
              error: {
                code: "CONDITION_INPUT_MISSING",
                message: "A required condition input is missing.",
              },
            },
          ],
        );
      }

      const conditionValue = input[conditionKey];

      if (typeof conditionValue !== "boolean") {
        return failure(
          "INVALID_CONDITION_INPUT",
          "A condition input must be a boolean.",
          [
            ...nodeResults,
            {
              nodeId: current.id,
              status: "failed",
              error: {
                code: "INVALID_CONDITION_INPUT",
                message: "A condition input must be a boolean.",
              },
            },
          ],
        );
      }

      nodeResults.push({
        nodeId: current.id,
        status: "completed",
        output: { result: conditionValue },
      });

      const expectedHandle = conditionValue ? "true" : "false";
      const matchingEdges = edges.filter(
        (edge) =>
          edge.source === current!.id && edge.sourceHandle === expectedHandle,
      );

      if (matchingEdges.length !== 1) {
        return failure(
          "INVALID_CONDITION_BRANCH",
          "The condition must have exactly one edge for the selected branch.",
          nodeResults,
        );
      }

      current = nodeById.get(matchingEdges[0].target);
      continue;
    }

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

    current = nodeById.get(outgoingEdges[0].target);

    if (!current) {
      return failure(
        "INVALID_EDGE_TARGET",
        "An edge points to a node that does not exist.",
        nodeResults,
      );
    }
  }

  return {
    status: "completed",
    nodeResults,
  };
}
