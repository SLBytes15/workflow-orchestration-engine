# Week 3 — Retry Policy & Failure Persistence: audit and design proposal

**Original audit:** Nithin C · `member/nithin` · 29 October 2026
**Current-branch verification:** `member/mahak` at `4d273de` · 31 October 2026

**Status:** Retry execution remains **NOT IMPLEMENTED**. Decisions D1 (strip
orchestration-only task fields before handler dispatch) and D3 (keep execution
synchronous) are approved. D3 matches the current implementation; D1 is not yet
implemented. No retry worker, queue, retry schema, or durable DLQ is present.

---

## 1. Scope and non-claims

This document records the verified execution path, approved D1/D3 decisions,
and what retry and dead-letter support would require. It distinguishes approved
behavior from implementation and test evidence.

It does **not** claim that any of the following exist: automatic retries, exponential backoff,
a retry-attempt counter, retryable/non-retryable error classification, a durable dead-letter
queue (DLQ), a worker process, a lease/heartbeat, or exactly-once execution.

The Week 3 retry/DLQ requirement is **NOT IMPLEMENTED**. This branch provides a
verified synchronous execution baseline, but not retry policy enforcement,
retry attempts, backoff, or a DLQ.

---

## 2. Verified current behaviour

Every row was checked against the current source, not inferred from prior reports.

| Behaviour | Status | Evidence |
|---|---|---|
| Terminal failure persistence (`status`, `nodeResults`, `error`, `completedAt`) | IMPLEMENTED | `backend/src/services/execution.service.ts:297-333` |
| Optimistic guard on every execution update (status + exact prior `nodeResults`) | IMPLEMENTED | `backend/src/services/execution.service.ts:30-45` |
| Persistence failure surfaces as an error instead of a fabricated terminal state | IMPLEMENTED | `backend/src/services/execution.service.ts:313-331` (`EXECUTION_RESULT_PERSISTENCE_FAILED`) |
| Per-node structured error capture (`code` + `message`) | IMPLEMENTED | `backend/src/services/execution.runtime.ts:911-918` |
| Task timeout | IMPLEMENTED (wait-timeout only) | `backend/src/services/execution.runtime.ts:376-404` |
| Late handler settlement discarded, recorded failure retained | IMPLEMENTED | `backend/src/services/execution.runtime.ts:376-404` |
| Saga compensation, reverse completion order, per-node checkpoints | IMPLEMENTED | `backend/src/services/execution.runtime.ts:699-789` |
| Compensation errors stored separately from the task error | IMPLEMENTED | `backend/src/services/execution.runtime.ts:767-781` |
| Retry attempt counting | **NOT IMPLEMENTED** | no such field in `backend/src/models/WorkflowExecution.ts:140-211` |
| Backoff / delay / cap | **NOT IMPLEMENTED** | no code path references it |
| Retryable vs non-retryable classification | **NOT IMPLEMENTED** | every action failure is terminal (`execution.runtime.ts:911-918`) |
| Durable DLQ | **NOT IMPLEMENTED** | no queue, no worker |
| Duplicate-dispatch lease / idempotency key | **NOT IMPLEMENTED** | no `workerId`, `leaseExpiresAt`, or idempotency field |
| Mid-execution progress persistence | **NOT IMPLEMENTED** | `currentNodeId` written `null` at creation (`execution.service.ts:179`) and never updated |

### 2.1 Correction to the previous status report

Week 3 planning assumed "retry counts/timing may be recorded". That is not accurate. The
execution schema contains no attempt, delay, or retry-policy fields. Retry mentions in
`backend/src` are confined to tests/fixtures; no production path validates or acts on a
retry policy.

### 2.2 Execution is synchronous and single-shot

`POST /api/workflows/:workflowId/executions` authenticates the API key, derives
the tenant on the server, and calls `ExecutionService.startExecution()`.
The service tenant-scopes the workflow lookup, creates a `queued` execution
with a graph snapshot, persists `running`, and invokes `executeWorkflowGraph()`
inline in the same request. It persists compensation checkpoints when needed,
then persists the terminal result before returning the final execution to the
route. The route responds synchronously; the `queued` record is not a durable
queue or background-work handoff.

Persisted execution statuses are `queued`, `running`, `completed`, `failed`,
`compensating`, `compensated`, and `compensation_failed`. There is no worker
pool, resume point, or crash recovery. `currentNodeId` is initialized to
`null` and never updated. Outside compensation checkpoints, node progress is
not persisted per node; terminal state contains the runtime's node results.
Execution state is available through authenticated REST history/detail routes.

### 2.3 Script transformation and isolation

**IMPLEMENTED, UNIT-TESTED:** `transform-expression.validator.ts` parses a
version-1 JSON expression document with `constant`, `get`, and `object`
operations. It rejects malformed or unsupported operations, unknown fields,
duplicate/dangerous keys, and enforces 8 KiB UTF-8 source, AST depth 32,
256-node, and JSON nesting depth 32 limits. `transform.evaluator.ts` evaluates
these operations over normalized JSON input, returns JSON-compatible values,
and does not mutate or alias the supplied input.

**NOT IMPLEMENTED / NOT WIRED:** The execution runtime accepts a transform
action when `expression` is a non-empty string, but does not call the
validator/evaluator. It dispatches only through the supplied code-owned
`ActionRegistry`; no built-in production transform handler is established.
The evaluator's unit tests are not workflow integration tests and do not prove
OS/process isolation or tenant isolation.

There are no serialized input/output byte limits, hard CPU/memory limits, or
transform-specific cancellation. The expression/JSON limits above are
validator/evaluator guards, not a sandbox boundary for arbitrary code. An
ordinary Promise timeout does not terminate handler work. The
pre-existing script-isolation assessment and design files remain unchanged;
their earlier statements that no evaluator/language exists predate this
current-branch finding.

---

## 3. What "retry" and control fields mean in the codebase today

`docs/workflow-graph-contract.md:83` declares an optional task-level control:

```ts
retry?: { attempts: number; backoffMs: number };
```

The execution runtime does not validate the `retry` shape or use its values.
The graph contract is not runtime validation: malformed values (including
non-object JSON values) are not rejected as retry-policy errors. The test
fixtures use the documented shape, but passing validation does not mean retries
are implemented.

Approved **D1** is to strip orchestration-only fields (`retry` and `timeoutMs`)
before task-handler dispatch. That decision is **APPROVED, NOT IMPLEMENTED** on
this branch. `parseTaskActionConfig()` currently removes only
`compensationAction` and `compensationConfig`:

```ts
const taskConfig = { ...config };
delete taskConfig.compensationAction;
delete taskConfig.compensationConfig;
```

Thus `retry` and `timeoutMs` are both passed to `action.execute(input)` as
ordinary fields today. A handler that forwards its input can send these
orchestration fields downstream. No test currently verifies D1 stripping.

The existing runtime test confirms action-specific fields are preserved, but
does not separately assert stripping of orchestration fields. Implementing D1
requires updating this dispatch contract and adding a focused test.

---

## 4. Timeout semantics: why retries can duplicate side effects

`timeoutMs` is optional and must be a finite positive number. Zero, negative,
non-number, and non-finite values fail action-config validation before dispatch.
There is no configured maximum or integer-only requirement. The validated
field is currently still passed to the handler, contrary to approved D1.

`withTimeout()` starts a timer and returns `ACTION_TIMEOUT` when that timer
settles first. It does not pass a cancellation signal to the handler or cancel
the underlying promise. A later resolve or reject is consumed but ignored:
the timed-out node remains failed and its late result does not trigger a new
checkpoint or compensation. The service test covers both late resolution and
late rejection; in its Saga scenario the earlier successful task is
compensated, while the timed-out task remains failed. A handler that continues
after timeout may still perform external side effects that the runtime cannot
undo.

Consequence for retries: retrying a timed-out **side-effecting** task can produce two
completed effects. Timeout must therefore not be classified as retryable for `http`,
`sendEmail`, `sendSlack`, or `dbQuery` until an idempotency key is defined and honoured by the
downstream operation. PROPOSED.

---

## 5. Proposed retry policy (PROPOSED — not implemented)

### 5.1 Classification

Classify by **error code**, never by message text. The default must be *deny*: any code not on
the retryable list is non-retryable.

| Retryable (proposed) | Non-retryable (proposed) |
|---|---|
| `HTTP_503`, `HTTP_429` | `INVALID_ACTION_CONFIG` |
| connection reset / DNS failure (mapped code) | `UNSUPPORTED_TASK_ACTION` |
| `ACTION_TIMEOUT` — only for non-side-effecting actions | `ACTION_NOT_REGISTERED` |
| | `ACTION_HANDLER_FAILED` |
| | `INVALID_ACTION_OUTPUT` |
| | `INVALID_GRAPH`, `CYCLE_DETECTED`, `AMBIGUOUS_BRANCH` |
| | `COMPENSATION_ACTION_NOT_REGISTERED`, `COMPENSATION_HANDLER_FAILED` |

Compensation actions are not retried under this proposal: a compensation failure is already
recorded per node and the execution terminal status is `compensation_failed`, so replay is a
separate, riskier decision (see D6).

### 5.2 Attempts and backoff

- `attempts`: maximum 3 total dispatches (initial + 2 retries).
- Delay: `backoffMs * 2^(attempt - 1)`, capped at 30 000 ms.
- Jitter: deterministic, derived from `executionId + nodeId + attempt`, not `Math.random`, so
  the delay is reproducible in tests without real sleeps.
- The per-node timeout is independent of the retry budget. Worst-case node wall clock is
  bounded by `attempts * (timeoutMs + maxBackoff)`.
- The attempt must be persisted **before** dispatch. Persisting after the dispatch loses the
  count on a crash and causes a re-dispatch.

### 5.3 Persistence requirements (SCHEMA CHANGE — approval required)

New fields on `WorkflowExecution` (or a dedicated attempts sub-document):

- `attempts` (number)
- `nextAttemptAt` (Date)
- `lastErrorCode` (string)
- `workerId` + `leaseExpiresAt` (duplicate-dispatch guard)

The status enum must **not** gain a `retrying` value without approval. The current enum is
`queued | running | completed | failed | compensating | compensated | compensation_failed`
(`WorkflowExecution.ts:159-172`). A retry-waiting execution can be represented as `queued`
with `nextAttemptAt` set, which avoids a status-contract change across API and UI.

---

## 6. Duplicate dispatch and idempotency (blocking requirement)

Today, execution is synchronous and single-shot, so two concurrent requests create two
separate execution records rather than double-dispatching one record. Introducing a worker
creates the real duplication risk:

1. A crashed worker leaves `status: running` with no way to distinguish live from dead work.
2. A retry after an unconfirmed dispatch repeats the side effect.
3. The optimistic guard compares the full `nodeResults` array, which is a valid lost-update
   guard within one synchronous run but is not a lease.

Therefore, until a lease and an idempotency contract exist:

- side-effecting actions (`http`, `sendEmail`, `sendSlack`, `dbQuery`) stay **non-retryable**;
- no worker is introduced;
- the existing synchronous path is unchanged.

### 6.1 DLQ definition (PROPOSED)

A dead-letter queue requires a store that survives process restart. Proposal: after the final
attempt fails, the execution is marked `status: failed` with `attempts: N`, its error
recorded, and a dead-letter marker (`deadLetteredAt`) so failed-after-exhaustion runs can be
queried separately. An in-memory list is **not** a DLQ and must never be described as one.

---

## 7. Decision status

| ID | Decision | Status / owner |
|---|---|---|
| D1 | Strip orchestration-only `retry` and `timeoutMs` fields before handler dispatch. | Approved; implementation pending |
| D2 | Is the schema change approved (`attempts`, `nextAttemptAt`, `lastErrorCode`, lease fields)? | Saransh / mentor |
| D3 | Keep Week 3 execution synchronous; do not introduce a queue/worker. | Approved; implemented |
| D4 | Idempotency key contract for side-effecting actions: header name, scope (per node or per attempt), who owns it. | Mentor |
| D5 | Represent retry waiting as `queued` + `nextAttemptAt`, or add a `retrying` status? | Saransh |
| D6 | On exhaustion: `failed` + `attempts = N` only, or a separate dead-letter record? Are compensation retries ever allowed? | Saransh / mentor |

Retry execution remains blocked by unresolved persistence, idempotency,
retry-state, and exhaustion/DLQ decisions (D2, D4-D6). Approved D1 is a
dispatch-boundary change and remains pending implementation.

---

## 8. Evidence label summary

- **IMPLEMENTED** — terminal failure persistence, optimistic update guard, structured per-node
  errors, wait-timeout with late-settlement handling, Saga compensation with per-node
  checkpoints, separate compensation error reporting.
- **APPROVED DECISIONS** — D1 calls for stripping `retry` and `timeoutMs` before handler dispatch; D3 keeps execution synchronous.
- **PENDING IMPLEMENTATION** — D1 field stripping and a regression test.
- **PROPOSED / DECISION PENDING** — retry classification, attempts/backoff, persistence fields,
  leases, idempotency contract, retry-state representation, and DLQ representation.
- **NOT IMPLEMENTED** — attempt counting, backoff, retry classification, retry execution,
  durable DLQ, worker/queue, leases, idempotency keys, mid-execution progress persistence.

---

## 9. What is safely testable without approved infrastructure

Backoff and DLQ behaviour cannot be tested because no code exists. Testing a private helper
that only the proposal mentions would assert invented behaviour.

Existing tests cover behaviour that does exist (the historical verification is
in `docs/verification/2026-10-29-nithin.md`):

1. A declared `retry` policy does not cause a second dispatch (runtime level).
2. A thrown handler is recorded as one attempt, not retried (runtime level).
3. Same, through the execution service: one `running` update, one terminal `failed` update,
   no retry-wait state.
4. Each node is dispatched exactly once per execution when a later node fails
   (duplicate-dispatch guard).

---

## 10. QA test matrix

| Feature / acceptance criterion | Existing test file or command | Expected behavior | Verification status / evidence |
|---|---|---|---|
| Synchronous execution and lifecycle persistence | `backend/src/services/execution.service.test.ts`; `backend/src/routes/execution.routes.test.ts` | Create `queued`, persist `running`, execute inline, persist terminal result before returning; REST reads the record. | **Unit/route-tested** with injected dependencies; no live MongoDB integration claimed. |
| Retry configuration validation | `backend/src/services/execution.runtime.test.ts` | Validate the contract shape `{ attempts: number; backoffMs: number }`. | **Not implemented / not tested**: runtime does not validate retry fields. |
| Retry execution | `backend/src/services/execution.runtime.test.ts`; `backend/src/services/execution.service.test.ts` | Retry metadata must not redispatch tasks; each handler is invoked once. | **Unit-tested** by the one-dispatch and one-attempt tests; no retry engine exists. |
| Approved D1 handler-input stripping | No focused test exists. | Remove `retry` and `timeoutMs` from handler input while preserving action-specific fields. | **Pending / unverified**: current parser forwards both fields. |
| Timeout validation and wait behavior | `backend/src/services/execution.runtime.test.ts` | Accept only finite positive `timeoutMs`; a handler exceeding it yields `ACTION_TIMEOUT` without waiting indefinitely. | **Unit-tested** for zero/negative values and a never-settling handler; source also rejects non-finite values, but those cases are not explicitly tested here. |
| Late timeout settlement | `backend/src/services/execution.service.test.ts` | Keep timeout failure when handler resolves or rejects after timeout; late settlement must not revise the result or add compensation checkpoints. | **Unit-tested** for both late resolve and reject. The handler is not cancelled; external side effects remain possible. |
| Handler dispatch and output validation | `backend/src/services/execution.runtime.test.ts` | Dispatch only registered actions; reject invalid config/output; persist valid JSON output. | **Unit-tested** with injected test handlers, not external task integrations. |
| Tenant isolation and API-key auth | `backend/src/routes/execution.routes.test.ts`; `backend/src/services/execution.service.test.ts` | Derive tenant from authenticated server context; deny cross-tenant workflow/execution access. | **Unit/route-tested** with stub resolvers and injected service dependencies; live-database integration remains unverified. |
| WebSocket ticket security and handshake | No implementation or test exists. | Approved ticket is unpredictable, tenant-bound, single-use, expires after 60 seconds; URL uses ticket, never API key. | **Pending / unverified**: no ticket route, store, or WebSocket handshake. |
| Tenant-scoped event publishing after persistence; send-failure isolation | No implementation or test exists. | Publish only after persistence; notify only the owning tenant; socket send failure cannot fail execution. | **Pending / unverified**: no socket registry or publisher. |
| Reconnect with fresh ticket, bounded backoff, and REST refresh | No implementation or frontend test exists. | Reconnect using a fresh ticket, then refresh authoritative REST state. | **Pending / unverified**: frontend is REST-only; no WebSocket client. |
| Bounded transform-expression validation/evaluation | `backend/src/validators/transform-expression.validator.test.ts`; `backend/src/services/transform.evaluator.test.ts` | Accept the supported v1 JSON expression AST and safely evaluate constants, paths, and object projections within configured expression/JSON limits. | **Unit-tested**; this does not prove workflow-handler integration or isolation. |
| Script isolation in workflow execution | No integration/isolation test exists. | Do not execute arbitrary user code; establish and verify a security boundary before enabling a transform handler. | **Pending / unverified**: evaluator is not wired to task dispatch and is not an OS/process sandbox. |

**Actual QA run (31 October 2026):** The focused command below passed all 86
tests (0 failed, 0 skipped). The run covered the test files listed in the
command; it did not cover WebSocket behavior, live MongoDB persistence, or
script isolation.

Run the backend unit/route tests from `backend/`:

```powershell
npx tsx --test src/services/execution.runtime.test.ts src/services/execution.service.test.ts src/routes/execution.routes.test.ts src/validators/transform-expression.validator.test.ts src/services/transform.evaluator.test.ts
```

These tests use fakes or in-process route dependencies; do not point them at
shared MongoDB Atlas. No WebSocket test command exists on this branch.

## 11. Reviewer checklist and demo flow

1. **Verify synchronous execution:** start an execution and confirm the HTTP
   request returns only after a terminal result is available; confirm there
   is no queue/worker handoff.
2. **Verify retry behavior:** run the existing one-dispatch tests. Retry
   configuration validation and approved D1 stripping cannot currently be
   demonstrated: retry shape is not validated and `retry`/`timeoutMs` still
   reach handlers.
3. **Verify timeout behavior:** use the runtime timeout tests; a timeout
   records `ACTION_TIMEOUT` but does not terminate handler work.
4. **Verify persisted state through REST:** use a dedicated non-shared test
   database for a real persistence demo, then retrieve the execution through
   the authenticated REST detail/history routes. The tests in the matrix use
   injected dependencies and are not live-database evidence.
5. **Verify WebSocket connection/ticket security:** **cannot be performed**;
   endpoints, ticket storage, handshake, and frontend client are not
   implemented.
6. **Verify tenant isolation:** run route/service tests with distinct tenant
   IDs; this checks current tenant scoping with test doubles, not live-database
   isolation.
7. **Verify transformation behavior:** run the validator/evaluator unit
   tests. A workflow-level transform execution or isolation demo **cannot be
   performed**; the evaluator is not registered/wired to workflow dispatch,
   and no sandbox boundary is implemented.

## 12. Limitations

- Retry execution, retry attempt counting, backoff, and retry-state persistence
  are not implemented. Valid-looking retry metadata does not enable retries.
- No worker/queue retry architecture, durable DLQ, lease, or idempotency-key
  contract exists.
- The runtime timeout only stops waiting; it cannot cancel a handler or undo
  late side effects.
- `currentNodeId` remains `null`; there is no durable per-node progress except
  compensation checkpoints and terminal results.
- WebSocket notifications have no implementation, replay, exactly-once
  delivery, or multi-instance pub/sub guarantee. The approved MVP is
  best-effort only.
- The transform evaluator has bounded JSON-AST operations, but no execution
  handler wiring, OS/process isolation, resource enforcement, or tenant
  isolation proof.
- The execution, tenant, and transform tests listed above do not establish
  live MongoDB integration or production readiness.

## 13. References

- `backend/src/services/execution.service.ts`
- `backend/src/services/execution.runtime.ts`
- `backend/src/models/WorkflowExecution.ts`
- `docs/workflow-graph-contract.md` (§2 task config, §6 execution)
- `docs/backend/execution-contract.md` (§4 lifecycle and retry limitations)
- `docs/architecture.md` (current synchronous path and future worker components)
- `docs/websocket-execution-updates.md` (approved contract and implementation status)
- `docs/backend/script-transformation-isolation-assessment.md`
- `docs/backend/script-transformation-isolation-design.md`
- `docs/backend/saga-readiness-test-matrix.md` (S-06 retry expectation, S-07 idempotency)
