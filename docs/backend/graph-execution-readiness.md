# Graph Execution Readiness Audit

Status: **audit only**. No contract, validator, schema, route, or runtime change
is included in this PR.
Author: Nithin
Date: 18-Oct-2026
Repository state audited: `baf1775` (`origin/main`)
Scope: backend graph validator, graph fixtures, graph types, and validator tests.

This note does not modify `docs/workflow-graph-contract.md`. It records which
graph rules the backend actually enforces, which inputs are accepted without
being constrained, and which runtime questions must be decided before an
execution engine is written.

---

## 1. Files inspected

| File | Role |
|---|---|
| `backend/src/validators/workflow-graph.validator.ts` | the only structural graph validator |
| `backend/src/validators/workflow-graph.validator.test.ts` | 22 tests over the validator |
| `backend/src/validators/validGraph.fixture.ts` | in-code valid graph used by several tests |
| `backend/src/validators/workflow.validator.ts` | requires `graph` on workflow creation and delegates to the graph validator |
| `docs/fixtures/*.json` | 9 graph fixtures (1 valid, 8 invalid) |
| `backend/src/models/workflow.model.ts` | stores `graph` as `Schema.Types.Mixed`, required |
| `backend/src/models/WorkflowExecution.ts` | stores `graphSnapshot` as `Mixed`, required |
| `backend/src/services/execution.service.ts` | copies `workflow.graph` into `graphSnapshot` |
| `docs/workflow-graph-contract.md` | agreed graph contract (unchanged) |

---

## 2. Verified pipeline: how a graph reaches an execution record

1. `POST /api/workflows` → `validateCreateWorkflow` rejects a request without
   `graph` and maps every `validateWorkflowGraph` error to `graph: <error>`.
2. `WorkflowModel` persists the graph verbatim in `graph` (`Mixed`, required).
3. `startExecution` creates one execution with `workflowVersion: workflow.version`,
   `graphSnapshot: workflow.graph`, `status: "queued"`, `currentNodeId: null`,
   `nodeResults: []`.
4. `enqueueExecution()` currently returns `false` because no queue or worker is
   configured. The service then **deletes the record** and throws
   `503 EXECUTION_QUEUE_UNAVAILABLE`.

Consequence: **no execution record survives today, so no graph has ever been
executed by the backend.** Everything in §6 is a design question, not an
observed runtime behaviour. This is not a defect in the graph validator, and it
is not changed by this note.

---

## 3. Enforced rules (verified in code and tests)

| Rule | Error text | Test evidence |
|---|---|---|
| Graph must be an object | `Graph must be an object` | `rejects a non-object graph` |
| `version === 1` (numeric) | `Graph version must be 1` | `rejects an unsupported graph version` |
| `nodes` and `edges` are arrays | `Graph nodes/edges must be an array` | `rejects missing node and edge arrays` |
| Node/edge `id` non-empty and unique | `... must be a non-empty string` / `must be unique` | `rejects duplicate node IDs`, `rejects the duplicate IDs fixture` |
| Node `type` ∈ trigger/task/condition | `... .type is unsupported` | `rejects unsupported node types` |
| `data.type === node.type` | `... data.type must match ...` | `rejects mismatched node data type` |
| `data.label` non-empty string | `... .data.label must be a non-empty string` | `rejects an empty node label` |
| `position.x/y` finite numbers | `... position.x must be a finite number` | `rejects non-finite node positions`, malformed position fixture |
| Exactly one trigger | `Graph must contain exactly one trigger node` | missing/multiple trigger tests |
| Edge endpoints reference existing nodes | `... source/target must reference an existing node` | edge endpoint test and fixture |
| Condition edges carry `"true"`/`"false"` | `... sourceHandle for a condition must be "true" or "false"` | `rejects an invalid condition branch handle` |
| Every condition has both branches | `... is missing its true/false branch` | both branch tests |
| No directed cycles | `Graph must not contain directed cycles` | cycle test and fixture |

Additional verified detail: when duplicate node IDs are present, the validator
skips cycle analysis because node identity is ambiguous. The graph is rejected
anyway, so this does not weaken enforcement.

---

## 4. Accepted but unconstrained today

Method: constructed graphs were passed through `validateWorkflowGraph` on
18-Oct-2026; each case below returned an empty error array (accepted).

| Input | Why it matters |
|---|---|
| A node unreachable from the trigger | The graph is still a DAG, so it passes. Execution would either skip it silently or never finish waiting for it. |
| A task with two outgoing edges | Next-node selection is undefined; results would depend on array order. |
| A condition with two `"true"` edges | Branch is structurally present but ambiguous; two targets match the same outcome. |
| Any node without `data.config` | Validator never inspects `config`, so an unexecutable node is accepted and persisted. |
| Config with invalid shape (`{ action: "not-a-real-action" }`) | Same: config contents are not validated. |
| `sourceHandle: "branch-true"` on a non-condition edge | Accepted as any non-empty string; harmless today, but the contract only defines condition handles. |
| An edge pointing into the trigger node | The contract's handle table gives the trigger no input, but the validator does not reject the edge. |
| Two edges with the same source/target and different ids | Duplicate relationships are not detected; both would be candidates at runtime. |
| Unknown extra fields on graph or node | Non-strict schema: forward-compatible, but also means typos pass unnoticed. |

Rejected for comparison: self-loop edges (cycle rule), empty node lists
(exactly-one-trigger rule), string `"1"` version (strict numeric check).

---

## 5. Test coverage gaps

- `workflow-graph.validator.test.ts` contains 22 tests over 9 fixtures.
- Five fixtures are asserted for their validator result:
  `valid-condition-graph.json`, `invalid-cycle.json`, `invalid-edge-endpoint.json`,
  `invalid-duplicate-ids.json`, `invalid-malformed-position.json`.
- Four invalid fixtures are only covered by the "all graph fixtures parse as
  JSON objects" test, with **no rejection assertion**:
  `invalid-missing-condition-branch.json`, `invalid-missing-trigger.json`,
  `invalid-multiple-triggers.json`, `invalid-version.json`.
- Each of those four does fail validation with the expected message when run
  directly, so the assertions are a genuine gap, not a suspected bug.

This PR adds exactly those four assertions. It does **not** assert the §4 cases,
because asserting current acceptance would lock in behaviour that has not been
decided.

---

## 6. Runtime semantics still undefined (decision required)

None of these can be answered from the repository today.

| # | Question | Current evidence | Risk if left undefined |
|---|---|---|---|
| 1 | Deterministic next-node selection when a node has several outgoing edges | Validator allows it; no engine exists | Same graph could execute differently across runs or after a refactor |
| 2 | Where a condition's result comes from and who evaluates it | `data.config` is unvalidated; edge `data.guard` is unvalidated | Conditions cannot be executed reliably; silent "always true" behaviour |
| 3 | Handling of duplicate branch edges from one condition | Accepted by validator | Two targets for one result; arbitrary winner |
| 4 | Unreachable nodes: reject at start, or skip at runtime? | Accepted by validator | Silent skipped work, or an execution that never terminates |
| 5 | Missing or invalid `config` at execution time | Accepted at creation | Run fails mid-flight instead of failing fast at start |
| 6 | Edges into a trigger node | Accepted when acyclic | Trigger semantics become ambiguous at runtime |
| 7 | Unknown node types at runtime | Impossible via the API today: creation rejects them | Only relevant if snapshots are ever written by another path |

Proposed safe defaults, **for Saransh to approve or replace** (not implemented):

1. Require exactly one outgoing edge per non-condition node; reject at start
   otherwise. Deterministic and cheap to validate.
2. Evaluate conditions only from a validated `data.config` of the agreed shape;
   treat a missing config as a start-time validation error.
3. Reject a second edge with the same `(source, sourceHandle)` at start.
4. Reject unreachable non-trigger nodes at start rather than skipping silently.
5. Reject incoming edges to trigger nodes.
6. Keep unknown node types a creation-time rejection; no runtime branch needed.

---

## 7. Proposed minimal fixtures and tests (not added today)

Add only after §6 is decided, so the fixtures encode agreed behaviour:

| Fixture | Expected after decision |
|---|---|
| `invalid-unreachable-node.json` | rejected if default 4 is approved |
| `invalid-task-multiple-outgoing.json` | rejected if default 1 is approved |
| `invalid-duplicate-condition-branch.json` | rejected if default 3 is approved |
| `invalid-missing-task-config.json` | rejected if default 2 is approved |
| `invalid-edge-into-trigger.json` | rejected if default 5 is approved |

Each needs one test asserting the specific error message, following the existing
fixture-test pattern in `workflow-graph.validator.test.ts`.

---

## 8. Contract alignment notes

- `docs/workflow-graph-contract.md` §4 rules 1–10 are enforced, with one
  difference: the validator requires a non-empty `data.label`, while the
  contract only types it as `string`. The stricter rule is reasonable for the
  canvas but is not written in the contract.
- §4 rule 11 (config-specific validation) is intentionally not implemented yet;
  the contract defers it until the field set is final. That deferral is why §4
  and §6 gaps exist.
- The contract says `sourceHandle` is required only on condition edges; the
  validator additionally requires any present non-condition `sourceHandle` to be
  a non-empty string. This is stricter, not conflicting.

No contract change is proposed in this PR.

---



## 9. Commands run and actual results

Run on `baf1775` + this branch, 18-Oct-2026, after `npm ci`:

| Command | Result |
|---|---|
| `npm ci` (backend) | completed, dependencies installed |
| `npm test` | 8 suites, 123 tests, 123 pass, 0 fail, 0 skipped, 4624ms |
| `npm run build` (tsc) | exit 0, no output |

Validator suite: `backend/src/validators/workflow-graph.validator.test.ts`, 26 tests,
including four fixture rejection assertions added in this PR (previously those four
invalid fixtures were only checked for JSON parseability).

Runtime behaviour is **not** covered by these results: no execution engine exists,
so `POST /api/workflows/:id/executions` returns 503 before any node is evaluated.

## 11. Non-goals

No frontend change, no graph-contract edit, no execution model, service, route,
or engine change, and no new dependency.