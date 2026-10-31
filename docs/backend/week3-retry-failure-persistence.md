# Week 3 — Retry Policy & Failure Persistence: audit and design proposal

**Author:** Nithin C · **Branch:** `member/nithin` · **Date:** 29 October 2026
**Updated:** 30 October 2026 — decisions D1 and D3 received; D1 implemented.

**Status:** audit complete. **D1 (strip + validate) is IMPLEMENTED and tested. D3 keeps
execution synchronous, so retry execution, backoff and a durable DLQ remain NOT
IMPLEMENTED.** No retry code, no queue, no worker, no schema change, and no new dependency
were added. The retry policy and DLQ requirement is still open on architecture, not on code.

---

## 1. Scope and non-claims

This document records what the current execution path does, and what a retry policy and
dead-letter queue would require. It is not a description of a delivered feature.

It does **not** claim that any of the following exist: automatic retries, exponential backoff,
a retry-attempt counter, retryable/non-retryable error classification, a durable dead-letter
queue (DLQ), a worker process, a lease/heartbeat, or exactly-once execution.

The Week 3 requirement (DLQ / retry policies) is therefore **NOT IMPLEMENTED**. What is
delivered here is a verified baseline, a bounded design, and the decisions needed to proceed.

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
execution schema contains no attempt, delay, or retry-policy fields, and a repository-wide
search for `retry`, `backoff`, and `attempt` in `backend/src` returns only prose strings
("No automatic compensation replay will be attempted.") and unrelated test names.

### 2.2 Execution is synchronous and single-shot

`startExecution` runs the graph inside the HTTP request (`execution.service.ts:265`). There is
no queue, no worker pool, and no resumption point. `nodeResults` are persisted only during
compensation checkpoints and at terminal state, and `currentNodeId` is never updated, so the
database holds no "current step" or "current attempt" for a running execution.

---

## 3. What "retry" means in the codebase today

`docs/workflow-graph-contract.md:83` declares an optional task-level control:

```ts
retry?: { attempts: number; backoffMs: number };
```

No code executes it, and before 30 October it was not validated either.

**Decision D1 (approved 30 October 2026): strip + validate.** The observed leak is now
closed:

- `parseTaskActionConfig` validates the shape of `retry` when present — a record whose
  `attempts` is an integer ≥ 1 and whose `backoffMs` is a finite number ≥ 0 — and fails
  with `INVALID_RETRY_CONFIG` before any handler is dispatched.
- `timeoutMs` keeps its existing validation (positive, finite) and is read from the parsed
  config, not from the handler input.
- Both fields are deleted from the payload passed to `action.execute(input)` and to the
  compensation context's `taskConfig`, so a handler that forwards its input can no longer
  transmit orchestration-only controls downstream.
- Both stay **inert**: `retry` is never acted on. The attempt cap and backoff policy are
  deliberately *not* enforced here — an out-of-policy `attempts: 5` is still shape-valid —
  because those numbers belong to the future implementation, not to today's contract.

Tests: `execution.runtime.test.ts` (payload stripped, timeout still enforced after
stripping, 13 malformed shapes rejected without dispatch, well-formed shape accepted but
not executed) and `execution.service.test.ts` (task and compensation payloads carry
neither field). The assertion that previously locked the leaking payload,
`assert.deepEqual(receivedInput, task.data.config)`, now compares against the stripped
config because the test config carries no orchestration fields.

---

## 4. Timeout semantics: why retries can duplicate side effects

A timeout stops *waiting*; it does not stop the handler. The comment at
`execution.runtime.ts:367-375` states this explicitly: the underlying action keeps running,
may still perform external side effects, and its eventual result is discarded. Because the
node is recorded `failed`, those late side effects are never compensated.

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

## 7. Decisions

| ID | Decision | Owner | State |
|---|---|---|---|
| D1 | `retry` field handling: leave inert / reject at validation / strip from handler input / implement. | Saransh | **DECIDED 30 Oct 2026 — strip + validate, keep inert. DONE.** |
| D3 | Is a queue/worker process approved for Week 3, or does execution stay synchronous? | Saransh / mentor | **DECIDED 30 Oct 2026 — execution stays synchronous; no worker, no in-request retry sleeps, no queue infrastructure in this task.** |
| D2 | Is the schema change approved (`attempts`, `nextAttemptAt`, `lastErrorCode`, lease fields)? | Saransh / mentor | Open — only relevant if D3 is revisited |
| D4 | Idempotency key contract for side-effecting actions: header name, scope (per node or per attempt), who owns it. | Mentor | Open — only relevant if D3 is revisited |
| D5 | Represent retry waiting as `queued` + `nextAttemptAt`, or add a `retrying` status? | Saransh | Open — only relevant if D3 is revisited |
| D6 | On exhaustion: `failed` + `attempts = N` only, or a separate dead-letter record? Are compensation retries ever allowed? | Saransh / mentor | Open — only relevant if D3 is revisited |

D1 has been implemented. D3 fixes the architecture for Week 3, which parks D2, D4, D5 and D6:
none of them can be acted on while execution stays synchronous.

---

## 8. Label summary

- **IMPLEMENTED** — terminal failure persistence, optimistic update guard, structured per-node
  errors, wait-timeout with late-settlement handling, Saga compensation with per-node
  checkpoints, separate compensation error reporting, retry/timeout shape validation, and
  stripping of orchestration-only fields from task and compensation payloads.
- **PROPOSED** — retry classification, attempt/backoff policy, persistence fields, lease and
  idempotency contract, DLQ representation, decisions D2/D4/D5/D6.
- **NOT IMPLEMENTED** — attempt counting, backoff, retry classification, retry execution,
  durable DLQ, worker/queue, leases, idempotency keys, mid-execution progress persistence.
  `retry` remains declared, validated and inert; it is never acted on.

---

## 9. What is safely testable without approved infrastructure

Backoff and DLQ behaviour cannot be tested because no code exists. Testing a private helper
that only the proposal mentions would assert invented behaviour.

Tests added for behaviour that does exist (see `docs/verification/2026-10-29-nithin.md`):

1. A declared `retry` policy does not cause a second dispatch (runtime level).
2. A thrown handler is recorded as one attempt, not retried (runtime level).
3. Same, through the execution service: one `running` update, one terminal `failed` update,
   no retry-wait state.
4. Each node is dispatched exactly once per execution when a later node fails
   (duplicate-dispatch guard).

Added with the D1 implementation (`docs/verification/2026-10-30-nithin.md`):

5. Malformed `retry` shapes are rejected before dispatch and the handler is never called.
6. A well-formed `retry` is accepted and still dispatched exactly once.
7. `retry` and `timeoutMs` are absent from the handler payload, while `timeoutMs` still
   ends the wait.
8. The same two fields are absent from the compensation context's `taskConfig`.

---

## 10. References

- `backend/src/services/execution.service.ts`
- `backend/src/services/execution.runtime.ts`
- `backend/src/models/WorkflowExecution.ts`
- `docs/workflow-graph-contract.md` (§2 task config, §6 execution)
- `docs/backend/execution-contract.md` (§4 states retries are absent; unresolved questions)
- `docs/architecture.md` (lists `Retry / DLQ` under *future* components, not implemented)
- `docs/backend/saga-readiness-test-matrix.md` (S-06 retry expectation, S-07 idempotency)
