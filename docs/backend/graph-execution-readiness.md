# Graph Execution Readiness Audit

Status: **audit only** — no contract, validator, schema, runtime or route change is
included in this PR.
Author: Nithin
Date: 19-Oct-2026 — revision 2
Repository state audited: `78b3f42` (`origin/main`)
Supersedes: revision 1 (18-Oct, commit `4695d4b`), written before
`backend/src/services/execution.runtime.ts` existed.

This note does not modify `docs/workflow-graph-contract.md` or
`docs/backend/execution-contract.md`. It records what the code enforces at graph
creation, what it enforces at execution, where those two disagree, and which
fixtures the rest of the backend may rely on.

## 1. Files inspected

| File | Role |
|---|---|
| `backend/src/validators/workflow-graph.validator.ts` | structural graph validator + `WorkflowGraph` type |
| `backend/src/validators/workflow-graph.validator.test.ts` | 26 validator tests |
| `backend/src/validators/validGraph.fixture.ts` | in-code valid graph used by earlier tests |
| `backend/src/services/execution.runtime.ts` | graph traversal and condition routing |
| `backend/src/services/execution.runtime.test.ts` | 7 runtime tests |
| `backend/src/services/execution.service.ts` | creates and retrieves execution records |
| `backend/src/models/WorkflowExecution.ts` | persisted execution shape |
| `docs/fixtures/*.json` | 9 JSON fixtures (1 valid, 8 invalid) |
| `docs/workflow-graph-contract.md` | agreed graph contract (unchanged) |
| `docs/backend/execution-contract.md` | execution contract (unchanged) |

## 2. What actually happens to a graph today

1. `POST /api/workflows` → `validateCreateWorkflow` requires `body.graph` and
   delegates to `validateWorkflowGraph`.
2. The graph is stored on `WorkflowModel.graph` (Mixed, required).
3. `startExecution` copies `workflow.graph` into `WorkflowExecution.graphSnapshot`
   together with `workflowVersion`, and creates the record with `status: "queued"`.
4. `enqueueExecution()` returns `false` — no queue or worker is configured — so the
   service deletes the record and throws `503 EXECUTION_QUEUE_UNAVAILABLE`.
5. `executeWorkflowGraph()` exists and is tested, but **no production module imports
   it**: `git grep executeWorkflowGraph` matches only the runtime and its test.

Consequence: the runtime is implemented but unreachable through the API. Nothing in
this note treats execution as proven end to end.

## 3. Enforced at graph creation (validator)

| Rule | Error text |
|---|---|
| Graph is an object; `version === 1` | `Graph version must be 1` |
| `nodes` and `edges` are arrays | `Graph nodes must be an array` |
| Node `id` non-empty string, unique | `nodes[i].id must be unique` |
| Node `type` in `trigger`, `task`, `condition` | unsupported node type error |
| `data.type` equals node `type` | mismatched type error |
| `data.label` non-empty string | label error |
| `position` with finite `x`/`y` | position error |
| Exactly one trigger | `exactly one trigger` |
| Edge `id` non-empty, unique | duplicate edge id error |
| Edge `source`/`target` reference existing nodes | endpoint error |
| Condition outgoing edges use `sourceHandle` `true` and `false`, both present | missing branch error |
| Edges leaving non-condition nodes may omit `sourceHandle` | — |
| Directed cycles rejected | cycle error |

Evidence: `backend/src/validators/workflow-graph.validator.test.ts` (26 tests) and the
9 fixtures in `docs/fixtures/`.

## 4. Enforced at execution (runtime)

`executeWorkflowGraph(graph, input)` in `backend/src/services/execution.runtime.ts`:

| Rule | Behaviour | Error code |
|---|---|---|
| Traversal | starts at the single trigger, follows one outgoing edge at a time | — |
| Condition input | `data.conditionKey` must exist and `input[key]` must be a boolean | `CONDITION_NOT_CONFIGURED`, `CONDITION_INPUT_MISSING`, `INVALID_CONDITION_INPUT` |
| Condition routing | exactly one edge from the condition with `sourceHandle` equal to `"true"` or `"false"` | `INVALID_CONDITION_BRANCH` |
| Non-condition fan-out | more than one outgoing edge fails the run | `AMBIGUOUS_BRANCH` |
| Terminal node | zero outgoing edges ends the run | — |
| Revisit | revisiting a node fails the run | `CYCLE_DETECTED` |
| Unreachable nodes | never visited, never reported, run still completes | — |
| Node results | only `completed` is produced for traversed nodes; no task output | — |
| Public errors | fixed codes and messages, no stack traces or internals | — |

Evidence: `backend/src/services/execution.runtime.test.ts` (7 tests).

## 5. Creation-time vs execution-time rules

| Case | Validator (creation) | Runtime (execution) |
|---|---|---|
| Task with two outgoing edges | accepted | fails `AMBIGUOUS_BRANCH` |
| Condition with two `"true"` edges | accepted | fails `INVALID_CONDITION_BRANCH` |
| Condition without `conditionKey` | accepted | fails `CONDITION_NOT_CONFIGURED` |
| Unreachable node | accepted | silently ignored |
| Node with no `config` | accepted | tasks still complete as no-ops |
| Unknown node type | rejected | unreachable (cannot be stored) |
| Cycle | rejected | defensive `CYCLE_DETECTED` only |
| Next-node selection | not modelled | exactly one outgoing edge required |

## 6. Unresolved decisions

1. **Validator parity.** The validator accepts graphs the runtime rejects. Decide
   whether multi-outgoing fan-out, duplicate branch edges and missing
   `conditionKey` should be rejected at creation, checked by a pre-flight call, or
   left to fail at execution.
2. **Unreachable nodes.** Silently ignoring them hides dead branches. Decide between
   rejection and recording them as `skipped`.
3. **`conditionKey` type.** The runtime reads a field absent from `WorkflowGraph`;
   the runtime test and the new fixtures both need a local cast. Decide whether the
   shared type should declare it.
4. **Node output.** `RuntimeNodeResult.output` exists but is never populated. D-07 in
   today's plan expects bounded, redacted output; undefined for now.
5. **Runtime wiring.** No queue or worker consumes queued records, so `startExecution`
   still returns 503. Wiring is Saransh's decision, not a fixture concern.
6. **Canonical fixture.** `backend/src/validators/validGraph.fixture.ts` has a
   condition node without `conditionKey`, so it validates but cannot execute. It is
   left untouched here because it belongs to the validator suite.
7. **Retries and compensation.** Not implemented, correctly not exposed as statuses.

## 7. Fixtures delivered by this PR

`backend/src/services/executionGraphs.fixture.ts` exports:

| Factory | Graph | Input | Expected node order |
|---|---|---|---|
| `linearGraphCase()` | trigger → task | `{}` | `trigger-1`, `task-1` |
| `conditionGraphCase("true")` | trigger → condition → true task | `{ approved: true }` | `trigger-1`, `condition-1`, `task-true` |
| `conditionGraphCase("false")` | trigger → condition → false task | `{ approved: false }` | `trigger-1`, `condition-1`, `task-false` |

Each factory returns a fresh object, so tests cannot leak mutations between cases.
`executionGraphCases()` returns all three for table-driven tests.

Why code rather than JSON: service tests need importable, typed data. The JSON files
under `docs/fixtures/` remain the validator's own fixtures.

`backend/src/services/executionGraphs.fixture.test.ts` asserts, for every case, that
`validateWorkflowGraph` returns no errors and that `executeWorkflowGraph` completes
with the expected node order — 7 tests total.

## 8. Test coverage after this PR

| Suite | Count |
|---|---|
| Graph validator | 26 |
| Execution runtime | 7 |
| Execution graph fixtures (new) | 7 |
| Backend total | see §9 |

Not added deliberately: assertions that the validator rejects runtime-invalid graphs.
They would fail today, and encoding either behaviour in a test would pre-empt the
decision in §6.1.

## 9. Commands run and actual results

Run on `78b3f42` + this branch, 19-Oct-2026:

| Command | Result |
|---|---|
|| `cd backend && npm test` | 10 suites, 149 tests, 149 pass, 0 fail, 8268.25ms |
| | `cd backend && npm run build` | `tsc`, exit 0, no output |

## 10. Recommendation

Answer §6.1 and §6.2 first; they determine whether the next change is validator
rules, a pre-flight check, or documentation only. Do not wire the runtime into
`startExecution` before a worker/queue decision, otherwise the API will report
success without durable processing.

## 11. Non-goals

No frontend change, no graph-contract or execution-contract edit, no validator,
schema, route, service or runtime change, and no new dependency.