export type WorkflowGraphNodeType = "trigger" | "task" | "condition";

export interface WorkflowGraph {
  nodes: Array<{
    id: string;
    type: WorkflowGraphNodeType;
    position: { x: number; y: number };
    data: {
      type: WorkflowGraphNodeType;
      label: string;
    };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
  }>;
}

const SUPPORTED_NODE_TYPES = new Set([
  "trigger",
  "task",
  "condition",
]);

/**
 * Returns an array of validation errors.
 * An empty array means the graph passed these checks.
 */
export function validateWorkflowGraph(value: unknown): string[] {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return ["Graph must be an object"];
  }

  if (!Array.isArray(value.nodes)) {
    errors.push("Graph nodes must be an array");
  }

  if (!Array.isArray(value.edges)) {
    errors.push("Graph edges must be an array");
  }

  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return errors;
  }

  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const nodeTypes = new Map<string, string>();
  const adjacency = new Map<string, string[]>();

  value.nodes.forEach((node: unknown, index: number) => {
    const path = `nodes[${index}]`;

    if (!isRecord(node)) {
      errors.push(`${path} must be an object`);
      return;
    }

    const { id, type, position, data } = node;

    if (typeof id !== "string" || !id.trim()) {
      errors.push(`${path}.id must be a non-empty string`);
    } else if (nodeIds.has(id)) {
      errors.push(`${path}.id must be unique`);
    } else {
      nodeIds.add(id);
      adjacency.set(id, []);
    }

    if (typeof type !== "string" || !SUPPORTED_NODE_TYPES.has(type)) {
      errors.push(`${path}.type is unsupported`);
    }

    if (typeof id === "string" && typeof type === "string") {
      nodeTypes.set(id, type);
    }

    if (!isRecord(position)) {
      errors.push(`${path}.position must be an object`);
    } else {
      if (!isFiniteNumber(position.x)) {
        errors.push(`${path}.position.x must be a finite number`);
      }
      if (!isFiniteNumber(position.y)) {
        errors.push(`${path}.position.y must be a finite number`);
      }
    }

    if (!isRecord(data)) {
      errors.push(`${path}.data must be an object`);
      return;
    }

    if (
      typeof data.type !== "string" ||
      !SUPPORTED_NODE_TYPES.has(data.type)
    ) {
      errors.push(`${path}.data.type is unsupported`);
    } else if (data.type !== type) {
      errors.push(`${path}.data.type must match ${path}.type`);
    }

    if (typeof data.label !== "string" || !data.label.trim()) {
      errors.push(`${path}.data.label must be a non-empty string`);
    }
  });

  value.edges.forEach((edge: unknown, index: number) => {
    const path = `edges[${index}]`;

    if (!isRecord(edge)) {
      errors.push(`${path} must be an object`);
      return;
    }

    const { id, source, target, sourceHandle } = edge;

    if (typeof id !== "string" || !id.trim()) {
      errors.push(`${path}.id must be a non-empty string`);
    } else if (edgeIds.has(id)) {
      errors.push(`${path}.id must be unique`);
    } else {
      edgeIds.add(id);
    }

    const validSource =
      typeof source === "string" && nodeIds.has(source);
    const validTarget =
      typeof target === "string" && nodeIds.has(target);

    if (!validSource) {
      errors.push(`${path}.source must reference an existing node`);
    }

    if (!validTarget) {
      errors.push(`${path}.target must reference an existing node`);
    }

    if (validSource && validTarget) {
      adjacency.get(source as string)?.push(target as string);
    }

    if (sourceHandle !== undefined) {
      if (typeof sourceHandle !== "string" || !sourceHandle.trim()) {
        errors.push(`${path}.sourceHandle must be a non-empty string`);
      } else if (
        nodeTypes.get(source as string) === "condition" &&
        sourceHandle !== "true" &&
        sourceHandle !== "false"
      ) {
        errors.push(
          `${path}.sourceHandle for a condition must be "true" or "false"`,
        );
      }
    }
  });

  // Detect directed cycles using depth-first search.
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let hasCycle = false;

  function visit(nodeId: string): void {
    if (visiting.has(nodeId)) {
      hasCycle = true;
      return;
    }

    if (visited.has(nodeId)) {
      return;
    }

    visiting.add(nodeId);

    for (const neighbor of adjacency.get(nodeId) ?? []) {
      visit(neighbor);
    }

    visiting.delete(nodeId);
    visited.add(nodeId);
  }

  for (const nodeId of adjacency.keys()) {
    visit(nodeId);
  }

  if (hasCycle) {
    errors.push("Graph must not contain directed cycles");
  }

  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
