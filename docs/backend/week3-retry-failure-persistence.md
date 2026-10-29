# Week 3 — Retry Policy & Failure Persistence: audit and design proposal

**Author:** Nithin C · **Branch:** `member/nithin` · **Date:** 29 October 2026

**Status:** audit complete; implementation **NOT APPROVED and NOT STARTED**. No production retry
code, no queue, no worker, no schema change, and no new dependency were added.

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

No code reads it. `parseTaskActionConfig` copies the task config and removes only the two
compensation keys (`execution.runtime.ts:333-336`):

```ts
const taskConfig = { ...config };
delete taskConfig.compensationAction;
delete taskConfig.compensationConfig;
```

The result is passed to `action.execute(input)` (`execution.runtime.ts:906-910`), so `retry`
(and `timeoutMs`) reach registered handlers as ordinary input fields. A declared retry policy
is therefore inert **and** leaks into handler payloads — a handler that forwards its input
upstream would transmit `retry` to a third party.

The current behaviour is locked in by an existing assertion,
`execution.runtime.test.ts:206` (`assert.deepEqual(receivedInput, task.data.config)`), so
changing it is a contract change and requires a decision (see D1).

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

## 7. Decisions needed

| ID | Decision | Owner |
|---|---|---|
| D1 | `retry` field handling: leave inert / reject at validation / strip from handler input / implement. Current behaviour is "inert + leaks into input". | Saransh |
| D2 | Is the schema change approved (`attempts`, `nextAttemptAt`, `lastErrorCode`, lease fields)? | Saransh / mentor |
| D3 | Is a queue/worker process approved for Week 3, or does execution stay synchronous? | Saransh / mentor |
| D4 | Idempotency key contract for side-effecting actions: header name, scope (per node or per attempt), who owns it. | Mentor |
| D5 | Represent retry waiting as `queued` + `nextAttemptAt`, or add a `retrying` status? | Saransh |
| D6 | On exhaustion: `failed` + `attempts = N` only, or a separate dead-letter record? Are compensation retries ever allowed? | Saransh / mentor |

No implementation begins before D1-D6 are answered in writing.

---

## 8. Label summary

- **IMPLEMENTED** — terminal failure persistence, optimistic update guard, structured per-node
  errors, wait-timeout with late-settlement handling, Saga compensation with per-node
  checkpoints, separate compensation error reporting.
- **PROPOSED** — retry classification, attempt/backoff policy, persistence fields, lease and
  idempotency contract, DLQ representation, decisions D1-D6.
- **NOT IMPLEMENTED** — attempt counting, backoff, retry classification, retry execution,
  durable DLQ, worker/queue, leases, idempotency keys, mid-execution progress persistence.

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

---

## 10. References

- `backend/src/services/execution.service.ts`
- `backend/src/services/execution.runtime.ts`
- `backend/src/models/WorkflowExecution.ts`
- `docs/workflow-graph-contract.md` (§2 task config, §6 execution)
- `docs/backend/execution-contract.md` (§4 states retries are absent; unresolved questions)
- `docs/architecture.md` (lists `Retry / DLQ` under *future* components, not implemented)
- `docs/backend/saga-readiness-test-matrix.md` (S-06 retry expectation, S-07 idempotency)
