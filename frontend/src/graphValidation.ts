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

export function validateWorkflowGraph(input: unknown): string[] {
  const errors: string[] = [];

  if (!isObject(input)) return ["graph must be an object"];

  if (input.version !== 1) {
    errors.push(`version must be 1 (got ${String(input.version)})`);
  }

  const rawNodes = asArray(input.nodes);
  const rawEdges = asArray(input.edges);

  if (!rawNodes) errors.push("nodes must be an array");
  if (!rawEdges) errors.push("edges must be an array");
  if (!rawNodes || !rawEdges) return errors;

  const nodes: LooseNode[] = [];
  const nodeIds = new Set<string>();
  const nodeTypeById = new Map<string, string>();

  for (const value of rawNodes) {
    if (!isObject(value)) {
      errors.push("every node must be an object");
      continue;
    }

    nodes.push(value);

    const id = value.id;
    if (typeof id !== "string" || id.trim() === "") {
      errors.push("every node needs a non-empty string id");
    } else if (nodeIds.has(id)) {
      errors.push(`duplicate node id "${id}"`);
    } else {
      nodeIds.add(id);
      if (typeof value.type === "string") nodeTypeById.set(id, value.type);
    }

    if (typeof value.type !== "string" || !NODE_TYPES.includes(value.type)) {
      errors.push(`node "${String(id)}" must have type trigger, task or condition`);
    }

    const data = value.data;
    if (!isObject(data)) {
      errors.push(`node "${String(id)}" must have a data object`);
    } else if (data.type !== value.type) {
      errors.push(`node "${String(id)}" must have data.type equal to its type`);
    }

    const position = value.position;
    if (
      !isObject(position) ||
      !isFiniteNumber(position.x) ||
      !isFiniteNumber(position.y)
    ) {
      errors.push(
        `node "${String(id)}" must have finite position.x and position.y`,
      );
    }
  }

  const triggerCount = nodes.filter((node) => node.type === "trigger").length;
  if (triggerCount !== 1) {
    errors.push(
      `graph must contain exactly one trigger node (found ${triggerCount})`,
    );
  }

  const edges: LooseEdge[] = [];
  const edgeIds = new Set<string>();

  for (const value of rawEdges) {
    if (!isObject(value)) {
      errors.push("every edge must be an object");
      continue;
    }

    edges.push(value);

    const id = value.id;
    if (typeof id !== "string" || id.trim() === "") {
      errors.push("every edge needs a non-empty string id");
    } else if (edgeIds.has(id)) {
      errors.push(`duplicate edge id "${id}"`);
    } else {
      edgeIds.add(id);
    }

    const source = value.source;
    const target = value.target;

    if (typeof source !== "string" || !nodeIds.has(source)) {
      errors.push(`edge "${String(id)}" references a missing source node`);
    }
    if (typeof target !== "string" || !nodeIds.has(target)) {
      errors.push(`edge "${String(id)}" references a missing target node`);
    }

    if (typeof source === "string" && nodeTypeById.get(source) === "condition") {
      const handle = value.sourceHandle;
      if (handle !== "true" && handle !== "false") {
        errors.push(
          `edge "${String(id)}" leaving condition "${source}" must have sourceHandle "true" or "false"`,
        );
      }
    }
  }

  // Rule 8 — every condition must expose both branches.
  for (const node of nodes) {
    if (node.type !== "condition" || typeof node.id !== "string") continue;

    const handles = edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => edge.sourceHandle);

    if (!handles.includes("true")) {
      errors.push(`Condition node "${node.id}" is missing its true branch`);
    }
    if (!handles.includes("false")) {
      errors.push(`Condition node "${node.id}" is missing its false branch`);
    }
  }

  // Rule 9 — the graph must be a DAG.
  if (errors.length === 0 && nodeIds.size > 0) {
    if (hasCycle([...nodeIds], edges)) {
      errors.push("graph must be acyclic (a cycle was detected)");
    }
  }

  return errors;
}
