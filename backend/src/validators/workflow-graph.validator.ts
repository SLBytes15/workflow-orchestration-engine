export type WorkflowGraphNodeType = "trigger" | "task" | "condition";

export interface WorkflowGraph {
  version: 1;
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
    targetHandle?: string;
    data?: unknown;
  }>;
}

const SUPPORTED_NODE_TYPES = new Set<string>(["trigger", "task", "condition"]);

export function validateWorkflowGraph(value: unknown): string[] {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return ["Graph must be an object"];
  }

  if (value.version !== 1) {
    errors.push("Graph version must be 1");
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
  const conditionBranches = new Map<string, Set<string>>();
  let triggerCount = 0;
  let duplicateNodeId = false;

  value.nodes.forEach((node: unknown, index: number) => {
    const path = `nodes[${index}]`;

    if (!isRecord(node)) {
      errors.push(`${path} must be an object`);
      return;
    }

    const { id, type, position, data } = node;
    const validId = typeof id === "string" && id.trim().length > 0;
    const validType =
      typeof type === "string" && SUPPORTED_NODE_TYPES.has(type);

    if (!validId) {
      errors.push(`${path}.id must be a non-empty string`);
    } else if (nodeIds.has(id)) {
      errors.push(`${path}.id must be unique`);
      duplicateNodeId = true;
    } else {
      nodeIds.add(id);
      adjacency.set(id, []);
    }

    if (!validType) {
      errors.push(`${path}.type is unsupported`);
    } else if (type === "trigger") {
      triggerCount += 1;
    }

    // Only use unambiguous, unique node IDs in graph relationships.
    if (validId && validType && !duplicateNodeId) {
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

    if (typeof data.type !== "string" || !SUPPORTED_NODE_TYPES.has(data.type)) {
      errors.push(`${path}.data.type is unsupported`);
    } else if (data.type !== type) {
      errors.push(`${path}.data.type must match ${path}.type`);
    }

    if (typeof data.label !== "string" || !data.label.trim()) {
      errors.push(`${path}.data.label must be a non-empty string`);
    }

    if (validId && validType && type === "condition") {
      conditionBranches.set(id, new Set<string>());
    }
  });

  if (triggerCount !== 1) {
    errors.push("Graph must contain exactly one trigger node");
  }

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

    const validSource = typeof source === "string" && nodeIds.has(source);
    const validTarget = typeof target === "string" && nodeIds.has(target);

    if (!validSource) {
      errors.push(`${path}.source must reference an existing node`);
    }

    if (!validTarget) {
      errors.push(`${path}.target must reference an existing node`);
    }

    if (validSource && validTarget && !duplicateNodeId) {
      adjacency.get(source as string)?.push(target as string);
    }

    if (validSource && nodeTypes.get(source as string) === "condition") {
      if (sourceHandle !== "true" && sourceHandle !== "false") {
        errors.push(
          `${path}.sourceHandle for a condition must be "true" or "false"`,
        );
      } else {
        conditionBranches.get(source as string)?.add(sourceHandle);
      }
    } else if (
      sourceHandle !== undefined &&
      (typeof sourceHandle !== "string" || !sourceHandle.trim())
    ) {
      errors.push(`${path}.sourceHandle must be a non-empty string`);
    }
  });

  for (const [nodeId, branches] of conditionBranches) {
    if (!branches.has("true")) {
      errors.push(`Condition node "${nodeId}" is missing its true branch`);
    }
    if (!branches.has("false")) {
      errors.push(`Condition node "${nodeId}" is missing its false branch`);
    }
  }

  // Skip cycle analysis when duplicate IDs make node identity ambiguous.
  if (!duplicateNodeId) {
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
  }

  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
