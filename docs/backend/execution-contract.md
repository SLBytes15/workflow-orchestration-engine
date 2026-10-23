# Workflow Execution Contract

**Status:** Draft for team review  
**Owner:** Saransh  
**Scope:** Backend workflow execution model, API behavior, tenant isolation, and integration expectations

## 1. Purpose

This document defines the contract for creating, retrieving, and tracking workflow executions in the Multi-Tenant Distributed Workflow & Saga Orchestration Engine.

It is intended to keep the model, API routes, service layer, graph validation, and future execution runtime consistent.

**Status labels used in this document:**

- **Verified:** Directly observed in the repository output reviewed so far.
- **Proposed:** A recommended contract that requires confirmation against the existing implementation.
- **Unresolved:** A question requiring code inspection or a team decision.

## 2. Current implementation baseline

The following files and behaviors have been observed in the repository:

| Area | Current evidence | Status |
|---|---|---|
| Execution model | `backend/src/models/WorkflowExecution.ts` | Verified: file exists |
| Execution service | `backend/src/services/execution.service.ts` | Verified: file exists |
| Execution routes | `backend/src/routes/execution.routes.ts` | Verified: file exists |
| Model tests | `backend/src/models/models.test.ts` | Verified: execution-related tests exist |
| Tenant-scoped retrieval | Service queries include `tenantId` alongside execution ID | Verified for the observed query |
| Execution history | Service contains `listExecutions`, including limit and cursor handling | Verified: implementation exists |
| API authentication | Execution routes use `requireTenantAuth` | Verified: middleware is referenced |
| Full lifecycle enforcement | Runtime and service tests cover task failure, compensation, checkpoint persistence, and terminal states | Verified for this synchronous slice |
| Actual graph execution runtime | `startExecution` invokes `executeWorkflowGraph`; supported task actions are dispatched through a code-owned registry | Verified |
| Cross-tenant isolation tests | Execution service queries scope workflow/execution IDs by tenant; service tests cover tenant scoping | Verified for observed service paths |

These observations are not a claim that the full execution flow has been tested or is production-ready.

## 3. Execution record

### 3.1 Existing model fields

The execution model previously reviewed in this project contains the following fields:

| Field | Intended purpose |
|---|---|
| `tenantId` | Identifies the owning tenant |
| `workflowId` | References the workflow being executed |
| `workflowVersion` | Records the workflow version |
| `graphSnapshot` | Stores a snapshot of the workflow graph |
| `status` | Tracks execution lifecycle state |
| `currentNodeId` | Identifies the current node, when applicable |
| `nodeResults` | Stores per-node execution information |
| `error` | Stores execution error information |
| `startedAt` | Records the execution start time |
| `completedAt` | Records the execution completion time |
| `createdAt`, `updatedAt` | Mongoose-managed timestamps |

The model lifecycle enum is `queued`, `running`, `completed`, `failed`,
`compensating`, `compensated`, and `compensation_failed`. Per-node results may
also contain compensation status, timestamps, and a structured compensation error.
The model defines tenant-related indexes and validates supported execution,
node-result, and compensation statuses.

### 3.2 Proposed record requirements

1. The execution must be associated with a workflow and its owning tenant.
2. The graph snapshot should represent the workflow definition accepted for that execution.
3. The recorded workflow version and graph snapshot should remain stable after execution creation.
4. Node results should use a consistent, documented structure.
5. Error details returned to clients must not expose secrets, stack traces, or private internal information.
6. Timestamps must have consistent meanings across the service and API.

**Unresolved:** Whether graph snapshots remain immutable after persistence. Supported node and compensation states are validated, and runtime action errors use structured codes/messages.

## 4. Execution lifecycle

### 4.1 Existing states

The model currently defines these states:

- `queued`
- `running`
- `completed`
- `failed`
- `compensating`
- `compensated`
- `compensation_failed`

### 4.2 Proposed lifecycle rules

| Current state | Proposed next state | Rule |
|---|---|---|
| `queued` | `running` | Execution begins processing |
| `queued` | `failed` | Execution fails before or during startup |
| `running` | `completed` | All required workflow work succeeds |
| `running` | `failed` | Execution cannot continue successfully |
| `running` | `compensating` | A task fails after eligible tasks completed |
| `compensating` | `compensated` | All eligible compensations succeed |
| `compensating` | `compensation_failed` | At least one compensation fails |
| `completed` | None | Terminal state |
| `failed` | None | Terminal state |
| `compensated` | None | Terminal state |
| `compensation_failed` | None | Terminal state |

The synchronous Saga v1 runtime uses these compensation lifecycle states:
`running` transitions to `compensating` when a task failure follows one or more
eligible successful tasks. Each eligible node is persisted as `pending`, then
`running` before its registered handler is invoked, then `completed` or
`failed` after the handler returns or throws. The execution ends as
`compensated` or `compensation_failed`. Each update is tenant-scoped and
conditionally matches the expected status and exact prior `nodeResults`
snapshot.

Task dispatch uses `data.config.action` plus its action-specific fields.
`compensationAction` is optional, and `compensationConfig` is optional when an
action is declared; if omitted, the registered handler receives an empty
object. A compensation config without an action is invalid. Both task and
compensation identifiers resolve only through code-owned registries; unknown
compensation actions prevent the task handler from running. Compensation
context includes trusted execution/workflow/node/tenant IDs, validated task
and compensation configs, and the recorded task output. A missing or invalid
task output is represented as `undefined` in that context; invalid action
output fails execution while leaving the successful task eligible for
compensation.

The original task error remains in `execution.error`; each compensation error
is recorded separately in its node's compensation metadata. Compensation runs
in reverse task-completion order and includes only successfully completed
tasks with registered compensation handlers. If a checkpoint fails, execution
stops and the service reports the persistence failure. If the terminal
checkpoint fails after a handler may have run, the last confirmed state is
not advanced locally, no successful completion is claimed, and the database
outcome may be uncertain. No replay is attempted.

The runtime does not add `cancelled`, `paused`, `retrying`, automatic retries,
crash recovery, or automatic replay of compensation left running. It does not
claim exactly-once execution. If MongoDB is unavailable, the service cannot
guarantee that an execution reaches a terminal persisted state.

**Unresolved questions:**

- Can execution be created directly in `running`?
- Is there a durable queue or worker responsible for processing queued executions?
- How are unexpected worker failures recovered?
- Can a failed execution be retried, and would that create a new execution record?
- What happens when two workers attempt to update the same execution?
- Exactly when should `startedAt` and `completedAt` be set?

## 5. Tenant isolation and authorization

### 5.1 Proposed security contract

1. Tenant identity must come from trusted authentication context.
2. The server must not trust a client-supplied `tenantId` in a request body or query parameter.
3. Every execution lookup, update, or deletion must be scoped to the authenticated tenant.
4. Workflow access must also be tenant-scoped before an execution is created.
5. Cross-tenant access must not disclose another tenant's execution records.
6. Authentication and authorization failures must use the established API error format.

The observed service includes tenant-scoped execution queries, and the routes reference `requireTenantAuth`. All relevant read and write paths still require review.

**Unresolved:** Whether every route uses the middleware correctly, whether workflow ownership is verified during execution creation, and whether tests cover cross-tenant requests.

## 6. API contract

The exact existing route paths, HTTP methods, and request schemas must be confirmed from `backend/src/routes/execution.routes.ts` before this section is treated as final.

### 6.1 Execution creation

**Proposed behavior:**

- Authenticate the caller and resolve trusted tenant context.
- Validate the workflow identifier and requested input.
- Verify that the workflow belongs to the tenant and is eligible for execution.
- Capture the workflow version and graph snapshot.
- Persist the execution record before reporting that it has been durably accepted.

If processing is asynchronous, return `202 Accepted` only when the system has durably accepted responsibility for processing the execution. Otherwise, use the status code appropriate to the actual synchronous behavior.

**Unresolved:** The current creation endpoint's exact request and response schemas, and whether a worker or queue exists.

### 6.2 Execution retrieval

**Proposed behavior:**

- Authenticate the caller.
- Retrieve the execution using both execution ID and trusted tenant ID.
- Return the documented execution representation.
- Return a consistent not-found response when the record is unavailable to that tenant.

### 6.3 Execution history and pagination

The service currently contains `listExecutions` with `limit`, `hasMore`, and `nextCursor`.

The observed validation rejects limits outside the integer range of 1–100 and validates execution-ID cursors.

**Proposed requirements:**

- Keep pagination bounded.
- Scope history queries to the authenticated tenant and the relevant workflow where applicable.
- Define a stable sort order.
- Ensure cursor semantics match the selected sort order.
- Return a consistent response shape.

The actual sort order, cursor filtering, and behavior for invalid or nonexistent cursors require code review.

## 7. API responses and errors

### 7.1 Proposed response principles

- Use the existing API response conventions rather than introducing a competing envelope.
- Return only fields required by the client.
- Keep status codes consistent with the operation's actual outcome.
- Avoid exposing internal exceptions, stack traces, database details, API keys, or secrets.

### 7.2 Proposed error categories

| Condition | Expected behavior |
|---|---|
| Missing or invalid authentication | Established unauthorized response |
| Invalid request fields | Validation error |
| Invalid identifier or cursor | Validation error |
| Execution unavailable to the tenant | Not-found response without cross-tenant disclosure |
| Unexpected internal failure | Generic server error |
| Database unavailable | Controlled failure; no false success response |

The exact error codes and response envelopes must match the existing backend conventions.

## 8. Node result contract

**Proposed minimum structure:**

- `nodeId`
- `status`
- Optional start and completion timestamps
- Optional JSON-safe output
- Optional sanitized error information

Proposed node statuses:

- `pending`
- `running`
- `completed`
- `failed`
- `skipped`

Node-level statuses are distinct from execution-level statuses.

**Unresolved:** Whether node results are currently schema-validated, how conditional branches represent skipped nodes, how outputs are size-limited, and how sensitive data is redacted.

## 9. Graph execution boundaries

Graph validation and graph execution are separate responsibilities.

Before implementing or extending the runtime, confirm:

- The accepted graph and node schema.
- How nodes are selected for execution.
- How multiple outgoing edges are handled.
- How conditional outputs map to true/false or other branches.
- What happens when a node fails.
- How unreachable nodes and invalid node types are handled.
- Whether cycles are allowed and, if so, under what rules.
- Whether node execution is deterministic for the same graph and inputs.

Do not assume that graph validation proves that a graph can be executed correctly.

Retries, live updates, sandboxing, and advanced scheduling remain outside this
runtime slice. Saga compensation is limited to the explicitly approved
synchronous v1 contract above.

## 10. Testing and acceptance criteria

The implementation should be reviewed against the following criteria:

- [ ] Model fields and lifecycle enum match the agreed contract.
- [ ] Execution creation validates the workflow and tenant relationship.
- [ ] Execution reads and writes are tenant-scoped.
- [ ] Cross-tenant access is rejected without leaking private records.
- [ ] Invalid identifiers and pagination inputs are handled consistently.
- [ ] Pagination order and cursor behavior are tested.
- [ ] Public error responses do not expose internal details.
- [ ] Lifecycle transitions and terminal-state rules are enforced where applicable.
- [ ] Graph snapshots and node results follow the agreed structure.
- [ ] Backend build and relevant automated tests pass.
- [ ] Database-dependent tests are identified separately from tests that use mocks or isolated model validation.
- [ ] Known limitations and environment-dependent tests are documented.

A checked item must be supported by actual implementation or test evidence. Do not mark a test as passing without running it.

## 11. Integration responsibilities

| Owner | Responsibility |
|---|---|
| Saransh | Own the execution contract, make integration decisions, resolve conflicting proposals, and coordinate integration |
| Mahak | Audit execution model and tests; report existing coverage and verified gaps |
| Swathi | Audit execution routes, authentication, validation, response conventions, and route tests |
| Nithin | Audit graph schema, validation behavior, fixtures, and unresolved runtime semantics |

These responsibilities follow the current task allocation and should be updated if the team explicitly reassigns work.

Each member should report:

1. Findings and evidence.
2. Files inspected or changed.
3. Commit or pull request reference, if applicable.
4. Exact test commands and results.
5. Remaining gaps and blockers.

## 12. Immediate integration checklist

1. Inspect the complete execution model, service, routes, and their tests.
2. Confirm actual endpoint paths, methods, request schemas, response shapes, and error conventions.
3. Compare implementation behavior against this contract.
4. Collect Mahak's, Swathi's, and Nithin's audit findings.
5. Record decisions and unresolved questions before assigning further implementation.
6. Select the smallest useful vertical slice for the next implementation phase.
7. Run the relevant build and tests and record the exact results.
8. Update this document when decisions are confirmed.

## 13. Minimal registered-action contract

The existing graph contract defines task configs with an `action` discriminator
and action-specific fields, for example:

```ts
{
  action: "sendEmail",
  to: "ops@example.test",
  subject: "Order created",
  body: "Order 42 was created",
  cc: ["audit@example.test"]
}
```

The runtime uses `config.action` as the registry key and passes the validated
action-specific config to its code-owned handler. Only documented action IDs
(`http`, `sendEmail`, `sendSlack`, `dbQuery`, and `transform`) are accepted.
Unregistered handlers and unknown action IDs fail safely. Tasks without config
remain traversal-only. A graph cannot provide handler implementations.

Task inputs and outputs are JSON-compatible: null, booleans, finite numbers,
strings, dense arrays, and plain objects containing only those values. Cycles,
accessors, symbols, undefined, functions, non-finite numbers, and non-plain
objects are rejected.

The runtime's minimal TypeScript interfaces are:

```ts
type RegisteredActionIdentifier =
  | "http" | "sendEmail" | "sendSlack" | "dbQuery" | "transform";
type JsonValue =
  | null | boolean | number | string
  | JsonValue[]
  | { [key: string]: JsonValue };
type ValidatedActionInput = Readonly<Record<string, JsonValue>>;

interface StructuredActionError {
  code: string;
  message: string;
}

type ActionResult =
  | { ok: true; output?: unknown }
  | { ok: false; error: StructuredActionError };

interface RegisteredAction {
  execute(input: ValidatedActionInput): Promise<ActionResult>;
}

interface ActionRegistry {
  taskActions: Readonly<Record<string, RegisteredAction>>;
}
```

If a handler succeeds but returns invalid output, its node remains recorded as
completed and the execution fails with `INVALID_ACTION_OUTPUT`. Thrown handler
exceptions become a structured `ACTION_HANDLER_FAILED`. The service also maps
an unexpected runtime exception to `RUNTIME_FAILED` and attempts to persist a
failed terminal result. If that persistence write fails, it returns
`EXECUTION_RESULT_PERSISTENCE_FAILED`; it does not fabricate a stored terminal
state.

**Compensation remains blocked:** The graph contract and the latest Saga
readiness matrix do not approve how a task declares its compensation action or
what input it receives. The runtime rejects a task config containing a
`compensation` property with `COMPENSATION_CONFIG_UNAPPROVED`; it does not
execute or persist compensation progress. Resolve this contract before
implementing compensation handlers. Do not infer compensation mapping from a
task action.

The default route service has no domain handlers registered. Register concrete
handlers only after action-specific validation is agreed. The runtime remains
synchronous and adds no queue, retry, recovery, or replay semantics; it makes
no exactly-once claim.

**Current decision:** This document is a working contract, not proof that every proposed behavior already exists. The next step is to verify the implementation and resolve the explicitly unresolved items before treating the contract as final.
**Implementation update:** Section 13 reflects the current runtime and identifies
the unresolved compensation declaration contract.
