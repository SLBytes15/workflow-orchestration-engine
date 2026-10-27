/**
 * Graph contract validation — mirrors docs/workflow-graph-contract.md §4.
 * Pure function: no React, no API calls, no side effects.
 * Returns an empty array when the graph satisfies the contract.
 */

const NODE_TYPES = ["trigger", "task", "condition"];

type LooseNode = Record<string, unknown>;
type LooseEdge = Record<string, unknown>;

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/** Kahn's algorithm — returns true when the graph contains a cycle. */
function hasCycle(nodeIds: string[], edges: LooseEdge[]): boolean {
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of nodeIds) {
    indegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    const source = typeof edge.source === "string" ? edge.source : null;
    const target = typeof edge.target === "string" ? edge.target : null;
    if (!source || !target) continue;
    if (!adjacency.has(source) || !indegree.has(target)) continue;

    adjacency.get(source)?.push(target);
    indegree.set(target, (indegree.get(target) ?? 0) + 1);
  }

  const queue = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  let visited = 0;

  while (queue.length > 0) {
    const current = queue.shift() as string;
    visited += 1;

    for (const next of adjacency.get(current) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  return visited !== nodeIds.length;
}

export interface GraphValidationError {
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export function validateWorkflowGraphDetailed(
  input: unknown,
): GraphValidationError[] {
  const issues: GraphValidationError[] = [];

  if (!isObject(input)) {
    return [{ message: "graph must be an object" }];
  }

  if (input.version !== 1) {
    issues.push({
      message: `version must be 1 (got ${String(input.version)})`,
    });
  }

  const rawNodes = asArray(input.nodes);
  const rawEdges = asArray(input.edges);

  if (!rawNodes) issues.push({ message: "nodes must be an array" });
  if (!rawEdges) issues.push({ message: "edges must be an array" });
  if (!rawNodes || !rawEdges) return issues;

  const nodes: LooseNode[] = [];
  const nodeIds = new Set<string>();
  const nodeTypeById = new Map<string, string>();

  for (const value of rawNodes) {
    if (!isObject(value)) {
      issues.push({ message: "every node must be an object" });
      continue;
    }

    nodes.push(value);

    const id = value.id;
    const stringId = typeof id === "string" ? id : undefined;

    if (typeof id !== "string" || id.trim() === "") {
      issues.push({ message: "every node needs a non-empty string id" });
    } else if (nodeIds.has(id)) {
      issues.push({
        message: `duplicate node id "${id}"`,
        nodeId: id,
      });
    } else {
      nodeIds.add(id);
      if (typeof value.type === "string") nodeTypeById.set(id, value.type);
    }

    if (typeof value.type !== "string" || !NODE_TYPES.includes(value.type)) {
      issues.push({
        message: `node "${String(id)}" must have type trigger, task or condition`,
        nodeId: stringId,
      });
    }

    const data = value.data;
    if (!isObject(data)) {
      issues.push({
        message: `node "${String(id)}" must have a data object`,
        nodeId: stringId,
      });
    } else if (data.type !== value.type) {
      issues.push({
        message: `node "${String(id)}" must have data.type equal to its type`,
        nodeId: stringId,
      });
    }

    const position = value.position;
    if (
      !isObject(position) ||
      !isFiniteNumber(position.x) ||
      !isFiniteNumber(position.y)
    ) {
      issues.push({
        message: `node "${String(id)}" must have finite position.x and position.y`,
        nodeId: stringId,
      });
    }
  }

  const triggerCount = nodes.filter((node) => node.type === "trigger").length;
  if (triggerCount !== 1) {
    issues.push({
      message: `graph must contain exactly one trigger node (found ${triggerCount})`,
    });
  }

  const edges: LooseEdge[] = [];
  const edgeIds = new Set<string>();

  for (const value of rawEdges) {
    if (!isObject(value)) {
      issues.push({ message: "every edge must be an object" });
      continue;
    }

    edges.push(value);

    const id = value.id;
    const stringEdgeId = typeof id === "string" ? id : undefined;

    if (typeof id !== "string" || id.trim() === "") {
      issues.push({ message: "every edge needs a non-empty string id" });
    } else if (edgeIds.has(id)) {
      issues.push({
        message: `duplicate edge id "${id}"`,
        edgeId: id,
      });
    } else {
      edgeIds.add(id);
    }

    const source = value.source;
    const target = value.target;

    if (typeof source !== "string" || !nodeIds.has(source)) {
      issues.push({
        message: `edge "${String(id)}" references a missing source node`,
        edgeId: stringEdgeId,
      });
    }
    if (typeof target !== "string" || !nodeIds.has(target)) {
      issues.push({
        message: `edge "${String(id)}" references a missing target node`,
        edgeId: stringEdgeId,
      });
    }

    if (typeof source === "string" && nodeTypeById.get(source) === "condition") {
      const handle = value.sourceHandle;
      if (handle !== "true" && handle !== "false") {
        issues.push({
          message: `edge "${String(id)}" leaving condition "${source}" must have sourceHandle "true" or "false"`,
          nodeId: source,
          edgeId: stringEdgeId,
        });
      }
    }
  }

  // Rule 8 — every condition must expose both branches (and at most one of each).
  for (const node of nodes) {
    if (node.type !== "condition" || typeof node.id !== "string") continue;

    const handles = edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => edge.sourceHandle);

    const trueCount = handles.filter((h) => h === "true").length;
    const falseCount = handles.filter((h) => h === "false").length;

    if (trueCount === 0) {
      issues.push({
        message: `Condition node "${node.id}" is missing its true branch`,
        nodeId: node.id,
      });
    } else if (trueCount > 1) {
      issues.push({
        message: `Condition node "${node.id}" has multiple true branches`,
        nodeId: node.id,
      });
    }

    if (falseCount === 0) {
      issues.push({
        message: `Condition node "${node.id}" is missing its false branch`,
        nodeId: node.id,
      });
    } else if (falseCount > 1) {
      issues.push({
        message: `Condition node "${node.id}" has multiple false branches`,
        nodeId: node.id,
      });
    }
  }

  // Rule 9 — the graph must be a DAG.
  if (issues.length === 0 && nodeIds.size > 0) {
    if (hasCycle([...nodeIds], edges)) {
      issues.push({
        message: "graph must be acyclic (a cycle was detected)",
      });
    }
  }

  return issues;
}

export function validateWorkflowGraph(input: unknown): string[] {
  return validateWorkflowGraphDetailed(input).map((issue) => issue.message);
}
