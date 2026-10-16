# Workflow Graph Contract — agreed

Status: **agreed** with Saransh and Mahak on 15-Oct-2026.
This is the canonical schema for workflow graphs. Both frontend and backend
MUST conform. The canvas stores the React Flow graph verbatim; the backend
validates and projects an execution spec only at run time.

---

## 1. Stored graph shape

```ts
{
  "version": 1,
  "nodes":  WorkflowFlowNode[],
  "edges":  WorkflowFlowEdge[]
}
```

- `version: 1` — bump on breaking changes.
- `nodes` and `edges` are stored as React Flow arrays, unmodified.
- The backend does **not** receive a separate "API payload" — it receives
  this exact shape.

---

## 2. Node shape

```ts
type WorkflowNodeType = "trigger" | "task" | "condition";

interface WorkflowNodeData {
  type: "trigger" | "task" | "condition";   // MUST match outer node.type
  label: string;
  config?: TriggerConfig | TaskConfig | ConditionConfig;  // optional in canvas
}

type WorkflowFlowNode = Node<WorkflowNodeData, WorkflowNodeType>;
```

Outer node required fields: `id` (unique, non-empty), `type` (one of the
three kinds), `position: { x: number, y: number }` (finite numbers), and
`data: WorkflowNodeData`. Backend validator requires `data.type === node.type`.

### Per-kind config (typed)

```ts
// ── Trigger ────────────────────────────────────────────────────────
type TriggerConfig =
  | { kind: "webhook";  method: "GET"|"POST"|"PUT"|"DELETE"; path: string; auth?: "none"|"apiKey"|"hmac" }
  | { kind: "schedule"; cron: string; timezone: string }       // IANA timezone
  | { kind: "event";    source: string; eventName: string; filter?: Record<string, unknown> };

// ── Task ───────────────────────────────────────────────────────────
type TaskAction = "http" | "sendEmail" | "sendSlack" | "dbQuery" | "transform";

type TaskConfig =
  | { action: "http";      method: "GET"|"POST"|"PUT"|"DELETE"|"PATCH"; url: string; headers?: Record<string,string>; body?: unknown; timeoutMs?: number }
  | { action: "sendEmail"; to: string; subject: string; body: string; cc?: string[] }
  | { action: "sendSlack"; channel: string; message: string; asUser?: string }
  | { action: "dbQuery";   connection: string; query: string; params?: unknown[] }
  | { action: "transform"; expression: string };

// Optional task-level controls (apply to any action):
interface TaskExtras {
  retry?: { attempts: number; backoffMs: number };
  continueOnError?: boolean;
}

// ── Condition ──────────────────────────────────────────────────────
type ConditionOp =
  | "equals"|"notEquals"|"gt"|"gte"|"lt"|"lte"
  | "contains"|"startsWith"|"matches"|"truthy";

interface ConditionClause { left: string; op: ConditionOp; right?: unknown }

type ConditionConfig =
  | { type: "clause"; clause: ConditionClause }
  | { type: "group";  logic: "and"|"or"; clauses: ConditionClause[] }
  | { type: "js";     expression: string };
```

---

## 3. Edge shape

```ts
interface WorkflowEdgeData {
  label?: string;
  guard?: { expression: string };
}

type WorkflowFlowEdge = Edge<WorkflowEdgeData, "default" | "smoothstep">;
```

Minimum fields used by validation: `id`, `source`, `target`.
Optional: `sourceHandle`, `targetHandle`, `data`.

### Handle IDs

| Node kind  | Target (input) | Source (output)                        |
| ---------- | -------------- | -------------------------------------- |
| trigger    | (none)         | (none — entry point)                   |
| task       | `"target"`     | `"source"`                             |
| condition  | `"target"`     | `"true"`, `"false"` (both required)    |

> **CRITICAL.** Condition source handles are **literally `"true"` and `"false"`**.
> These values appear on outgoing edges as `edge.sourceHandle` and are the only
> mechanism the execution engine uses to route condition branches. Any
> alternative ("branch-true", "yes"/"no", etc.) is invalid.

Edges on a `condition` MUST preserve `sourceHandle` end-to-end. The frontend
`onConnect` handler uses `addEdge` which preserves this automatically.

---

## 4. Structural validation rules

Backend (and optionally client) MUST enforce all of these. Invalid graphs
return HTTP 400 with a clear, non-leaking error.

1. `version === 1`.
2. `nodes` and `edges` are arrays; each element is an object.
3. Every node and edge has a unique, non-empty `id`.
4. Every node has `type ∈ { trigger, task, condition }` and
   `data.type === node.type`.
5. `position.x` and `position.y` are finite numbers.
6. Every `edge.source` and `edge.target` references an existing node id.
7. Exactly one `trigger` node.
8. Every `condition` node has at least one outgoing edge with
   `sourceHandle === "true"` and at least one with `sourceHandle === "false"`.
9. The graph is a **DAG** — no cycles.
10. `sourceHandle` is required only on edges leaving a `condition` node
    (and there it MUST be `"true"` or `"false"`).
11. **Config-specific rules** (cron parses, IANA timezone, action
    requirements, etc.) are documented above and implemented in the
    backend validator only after this spec is finalised for the field set.

> The graph body MUST NOT be used as an authorization source. Validation
> errors MUST NOT leak internal details.

---

## 5. Persistence

Frontend hands the backend the shape in §1 verbatim:

```http
POST /workflows
Content-Type: application/json

{ "version": 1, "nodes": [...], "edges": [...] }
```

The canvas does not maintain its own "API payload" representation. There is
one source of truth: the React Flow graph.

---

## 6. Execution spec projection (run time only)

The execution engine projects an `ExecutionSpec` from the validated graph at
run time. It is **not** part of the stored shape and is not produced by
the frontend.

```ts
interface ExecutionStep {
  nodeId: string;
  type: "trigger" | "task" | "condition";
  payload: WorkflowNodeData;
  next: Array<{ branch: "true" | "false" | "default"; target: string }>;
}

interface ExecutionSpec {
  entryNodeId: string;
  steps: ExecutionStep[];
}
```

---

## 7. Change control

- Any change to this file is breaking. Bump `version` in §1 in the same PR.
- Add new validation rules under §4 with explicit test fixtures.
- Add new config variants to §2 with full TypeScript definitions; do not
  introduce `Record<string, unknown>` placeholders without a tracked
  follow-up.
