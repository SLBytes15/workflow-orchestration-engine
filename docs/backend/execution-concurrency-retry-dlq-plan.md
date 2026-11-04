# Execution Architecture, Retry/DLQ Gap, and Safe Concurrency Plan

- **Author:** Nithin C
- **Branch:** `member/nithin` (starting SHA `ff29741`)
- **Date:** 4 November 2026
- **Status:** assessment complete. No production code changed. Retry execution and a durable DLQ remain **NOT IMPLEMENTED**.

This document answers the three parts of the 4 November task: verify the execution architecture against the 1,000+ concurrent pipeline requirement, define the minimum viable retry/DLQ path, and prepare safe concurrency testing.

Every line reference was checked against the current source on `member/nithin`, not carried over from earlier reports. Labels used: **VERIFIED**, **PARTIAL**, **NOT IMPLEMENTED**, **BLOCKED**.

---

## 1. Execution architecture — verified map

### 1.1 Execution start route

| Item | Evidence | Label |
|---|---|---|
| Start endpoint | `POST /api/workflows/:workflowId/executions` — `backend/src/routes/execution.routes.ts:16` | VERIFIED |
| Auth | `requireTenantAuth` on the same route; 401 when absent (`:20`) | VERIFIED |
| Tenant source | Tenant comes from the authenticated API key, never from the body or a header | VERIFIED |
| Router mounting | `app.ts` mounts the execution router at both `/api/workflows` and `/api/executions` | VERIFIED |
| Global limiter | `app.use("/api", apiRateLimiter)` — `backend/src/middleware/rateLimit.middleware.ts`, 100 requests / 15 min, default in-memory store | VERIFIED, see §5.3 |

### 1.2 Synchronous request execution, not a worker

`startExecution` (`backend/src/services/execution.service.ts:183`) runs the whole graph inside the HTTP request:

1. load workflow, tenant-scoped (`:190`)
2. create record with `status: "queued"`, `currentNodeId: null`, `nodeResults: []` (`:203`)
3. conditional update `queued → running` (`:221`)
4. `await executeWorkflowGraph(...)` inline (`:294`)
5. persist terminal state (`:327`)

There is no queue, no worker process, no job broker, and no resumption point. **VERIFIED.** Consequence: one HTTP request occupies one execution for its full duration; concurrency is bounded by the Node event loop plus per-node timeouts, not by any pool.

### 1.3 Active-execution coordination and multi-instance safety

| Concern | Current state | Evidence | Label |
|---|---|---|---|
| Concurrent writes to one execution | Guarded by an optimistic filter comparing `status` and the exact prior `nodeResults` array | `execution.service.ts:35` (`buildExecutionUpdateFilter`) | VERIFIED |
| Lease / heartbeat / ownership | Absent. No `workerId`, `leaseExpiresAt`, or heartbeat field | `backend/src/models/WorkflowExecution.ts` (schema fields, status enum `:162-171`) | NOT IMPLEMENTED |
| Cross-instance dispatch | **Unsafe by construction.** Each process opens its own change stream and dispatches on every matching insert, with no claim or dedupe | `changeStreamWatcher.service.ts:63` (`BusinessEventModel.watch`), `:80`, `:174` | VERIFIED (risk) |
| Resume token | Absent. Default `watch()` semantics start at subscription time, so inserts between a crash and restart are missed | `changeStreamWatcher.service.ts:62-66` | NOT IMPLEMENTED |
| Ordering within one process | Strictly sequential via a promise chain, so one slow execution delays every later event | `changeStreamWatcher.service.ts:89`, `:197` | VERIFIED |

The optimistic guard is a lost-update guard inside one run. It is **not** a lease: it cannot distinguish a live run from an abandoned one, and it does not prevent two instances from creating two separate execution records for the same event. This is the single most important finding for the 1,000+ requirement.

### 1.4 State persistence and transitions

Status enum (`WorkflowExecution.ts:162-171`): `queued | running | completed | failed | compensating | compensated | compensation_failed`, default `queued`.

- Terminal persistence writes `status`, `nodeResults`, `error`, `completedAt` (`execution.service.ts:327`).
- `currentNodeId` is written `null` at creation (`:205`) and never updated, so the database holds no current step, no attempt, and no progress marker.
- Mid-run persistence happens only at compensation checkpoints (`persistCheckpoint`, `:240`).

**VERIFIED.** A running execution is therefore indistinguishable from a dead one in the database.

### 1.5 Node timeout, failure, and Saga compensation

| Behaviour | Evidence | Label |
|---|---|---|
| Per-node wait timeout | `execution.runtime.ts:392` (`ACTION_TIMEOUT`), applied at `:426` | VERIFIED |
| Timeout does not cancel the handler; late settlement is discarded | comment at `:403`; regression tests in `execution.runtime.test.ts` | VERIFIED |
| Per-node structured error (`code` + `message`) | `execution.runtime.ts:968-976` (`INVALID_ACTION_OUTPUT`) and the shared failure path | VERIFIED |
| Compensation in reverse completion order | `execution.runtime.ts:738` (`.reverse()`), `:750`, `:766` | VERIFIED |
| Compensation dispatch | `invokeCompensation` at `:455` | VERIFIED |
| Compensation errors stored apart from the task error | covered in `execution.service.test.ts` | VERIFIED |

Known limitation, unchanged: a timed-out node is recorded `failed` and is therefore excluded from compensation, so a late side effect can escape compensation entirely.

### 1.6 Retry / DLQ status

| Item | State | Evidence |
|---|---|---|
| `retry: { attempts, backoffMs }` declared in the graph contract | Declared | `docs/workflow-graph-contract.md` |
| Shape validated before dispatch | IMPLEMENTED | `execution.runtime.ts:310-320` (`INVALID_RETRY_CONFIG`) |
| Stripped from handler payload | IMPLEMENTED | same block; tests in `execution.runtime.test.ts` |
| Retry executed (second dispatch) | **NOT IMPLEMENTED** | `execution.runtime.test.ts` asserts a declared policy does *not* redispatch |
| Attempt counter persisted | **NOT IMPLEMENTED** | no field in `WorkflowExecution.ts` |
| Backoff, jitter, cap | **NOT IMPLEMENTED** | no code path |
| Retryable / non-retryable classification | **NOT IMPLEMENTED** | every action failure is terminal |
| Durable DLQ | **NOT IMPLEMENTED** | no queue, no dead-letter store |
| Idempotency key | **NOT IMPLEMENTED** | no such field or header contract |

Decisions already taken (see `docs/backend/week3-retry-failure-persistence.md` §7): **D1** strip + validate, keep inert — done; **D3** execution stays synchronous, no worker and no queue — done. D2 (schema), D4 (idempotency contract), D5 (retry status representation) and D6 (exhaustion semantics) remain open and are parked by D3.

### 1.7 Change Stream and WebSocket impact on execution processing

`startServer` (`backend/src/index.ts`) runs four ordered steps: connect MongoDB → listen → attach the WebSocket hub to the same HTTP server → start the change-stream watcher. Shutdown stops the watcher, closes the socket hub, then closes HTTP.

Impact on execution:

- **Backpressure, not concurrency.** Event dispatch awaits `startExecution` per matching workflow (`changeStreamWatcher.service.ts:174`), so executions triggered by events are serialized inside one process.
- **Fan-out risk across instances.** Every instance watches the same collection, so event-triggered executions would multiply with instance count.
- **Replica-set dependency.** Change streams require a replica set; `startServer` treats watcher startup failure as fatal and exits (`index.ts`, step 3).
- The WebSocket hub only mirrors persisted state to subscribers; it does not drive execution.

### 1.8 Database and shared-state constraints

- `connectDatabase` (`backend/src/config/database.ts`) passes only `serverSelectionTimeoutMS: 5000`. No pool size, no read/write concern, no replica-set assertion.
- One shared cluster for all tenants; isolation is by `tenantId` filter in queries and by the authenticated tenant context, not by database or collection separation.
- No advisory locks, no distributed cache, no shared counters. The rate limiter is per-process in memory, so the effective limit multiplies with instance count.

---

## 2. Retry / DLQ gap plan

### 2.1 Separation of what exists from what is documented

| Claim sometimes made | Reality |
|---|---|
| "Retry policy supported" | The *shape* is validated and stripped; it is never executed. Documented-only. |
| "Failures are retried" | No. A handler exception becomes one terminal failure. |
| "DLQ exists" | No store, no marker field, no worker. |
| "Timeouts make retries safe" | No. Timeout stops waiting, not the handler. |

### 2.2 Recommended minimal path (Option A) — needs D2 + D6 approval

Scope is deliberately narrow: retry only what is safe to repeat, inside the existing synchronous runtime.

1. **Classify by error code, default deny.** Retryable: `HTTP_503`, `HTTP_429`, mapped connection/DNS failures. `ACTION_TIMEOUT` is retryable **only** for actions declared non-side-effecting. Everything else terminal, including `ACTION_HANDLER_FAILED`, `INVALID_ACTION_OUTPUT`, `INVALID_GRAPH`, all compensation codes.
2. **Bounded attempts.** Maximum 3 total dispatches (initial + 2). Backoff `backoffMs * 2^(n-1)`, capped at 30 000 ms, jitter derived deterministically from `executionId + nodeId + attempt` so tests need no real sleeps.
3. **Persist before dispatch.** Write `attempts` and `lastErrorCode` *before* calling the handler; persist after dispatch loses the count on a crash.
4. **Terminal failure after exhaustion.** `status: "failed"`, `attempts: N`, `lastErrorCode` set, `deadLetteredAt` written. The status enum does **not** gain `retrying`; a retry-waiting execution is `queued` with `nextAttemptAt`.
5. **DLQ is a query, not a service.** `deadLetteredAt` plus a tenant-scoped index is the dead-letter view. An in-memory list must never be called a DLQ.

Required schema additions (D2): `attempts`, `nextAttemptAt`, `lastErrorCode`, `deadLetteredAt`, `workerId`, `leaseExpiresAt`. Additive and nullable, so existing documents stay valid.

### 2.3 Option B — defer

Worker process, lease-based ownership, idempotency keys honoured by downstream actions, and a separate dead-letter collection. This is what "DLQ" means at 1,000+ concurrency, and it cannot be built safely before 10 November. Recommend documenting it as post-deadline.

### 2.4 Idempotency, duplicate processing, tenant isolation, recovery

- **Idempotency (blocking for retrying side effects).** No key exists today. Until one is defined and honoured, `http`, `sendEmail`, `sendSlack`, `dbQuery` stay non-retryable. Retrying a timed-out side effect can produce two completed effects.
- **Duplicate processing.** Synchronous execution means two requests create two records rather than double-dispatching one. Introducing a worker without a lease *creates* the duplication problem; the current design merely multiplies on event fan-out (§1.3).
- **Tenant isolation.** Every new query must be tenant-scoped: `{ tenantId, deadLetteredAt: { $ne: null } }` with `{ tenantId: 1, deadLetteredAt: -1 }`. A DLQ listing endpoint must never be global, and tests must prove tenant A cannot see tenant B's dead letters.
- **Recovery.** A `running` record with no lease and no `currentNodeId` is unrecoverable. Minimal recovery is a sweeper that marks stale `running` records `failed` with code `EXECUTION_ABANDONED` after an age threshold. It must **not** replay side effects, and it must be tenant-scoped. Needs its own approval — recorded here, not implemented.

### 2.5 Acceptance criteria

Each is testable with fakes; none requires a live database.

1. A retryable code with a valid policy dispatches exactly twice and succeeds on the second attempt.
2. A non-retryable code dispatches exactly once and is terminal.
3. Exhaustion produces `status: failed`, `attempts: 3`, `deadLetteredAt` set, `lastErrorCode` recorded.
4. `attempts` is persisted before the handler call, proven by a handler that throws on first dispatch.
5. Backoff delay is deterministic across runs for identical `executionId + nodeId + attempt`.
6. Backoff never exceeds the 30 000 ms cap.
7. A timed-out side-effecting action is **not** retried.
8. No retry occurs when the policy is absent.
9. A malformed policy is still rejected with `INVALID_RETRY_CONFIG` before dispatch.
10. Cross-tenant: a dead-letter query for tenant A never returns tenant B's record.
11. The existing 365-test suite stays green, including the "declared retry policy does not redispatch" regression, which must be **replaced** by the new behaviour rather than deleted silently.

---

## 3. Safe concurrency test preparation

### 3.1 Existing helpers

| Asset | What it does |
|---|---|
| `backend/scripts/benchmark-execution-concurrency.ts` | In-process harness over the real `executeWorkflowGraph` with synthetic delayed actions. Flags `--concurrency`, `--duration`, `--repetitions`. No HTTP, MongoDB, WebSocket, change stream, or external call. |
| `docs/verification/2026-11-03-nithin.md` | Baseline results and the staged plan this section refines. |
| `backend/src/services/executionGraphs.fixture.ts` | Shared graph fixtures usable for repeatable scenarios. |

### 3.2 How "genuinely active" is counted

Two definitions, and they must not be conflated:

- **Harness definition (authoritative for stage L0):** an execution is active from the moment its first node is dispatched until its last node settles. The harness tracks this with a live counter and reports `maxActive`, which is what proves real overlap.
- **Database definition (proxy for L1+):** records with `status` in `running` or `compensating`. This under-counts, because terminal state is the only write for a successful run and `currentNodeId` is never updated. Any report must state which definition it used.

### 3.3 Stages and stop conditions

| Stage | Setup | Load | Stop conditions |
|---|---|---|---|
| L0 | In-process harness (done) | 1 / 5 / 10 / 25 | any `failed > 0`; `maxActive < requested` |
| L1 | Single instance + isolated local MongoDB replica set | 25 → 100 | any 429 from the limiter; Mongo pool wait > 100 ms; p95 > 5 s |
| L2 | Isolated staging database | 100 → 500 | RSS growth > 50 % over baseline; failure rate > 0.1 %; change-stream lag rising |
| L3 | Multi-instance behind a load balancer | 500 → 1 000 | duplicate execution count > 0 (fan-out bug); any instance unhealthy |
| L4 | Soak | 70 % of L3 peak, 30 min | memory growth without plateau; latency drift |

Hard rule from the task: **no stage above L0 runs against the shared/live MongoDB.** L1 requires an isolated local replica set, L2+ requires isolated staging approval.

### 3.4 Metrics to capture per stage

Active executions (both definitions), throughput per second, p50/p95/p99 execution latency, failures by error code, completion count, process CPU and RSS, MongoDB connection-pool usage and op counters, change-stream lag, WebSocket subscriber count.

### 3.5 Today's L0 result

`npx tsx scripts/benchmark-execution-concurrency.ts --concurrency=1,5,10,25 --duration=10 --repetitions=1`

| Level | Completed | Failed | maxActive | avg elapsed ms | throughput/s |
|---|---|---|---|---|---|
| 1 | 1 | 0 | 1 | 28.97 | 34.51 |
| 5 | 5 | 0 | 5 | 15.42 | 324.34 |
| 10 | 10 | 0 | 10 | 14.62 | 683.83 |
| 25 | 25 | 0 | 25 | 15.65 | 1 597.01 |

**VERIFIED at L0.** This proves the runtime overlaps work rather than serialising it. It does not prove any ceiling, and it is not an API, database, or distributed-load measurement.

### 3.6 Coordination with Mahak

Mahak owns the branch audit and the backend gap backlog, including the global execution-history/summary API integration and the WebSocket manual integration scenarios. Split to avoid duplication:

- **Mahak:** API-level integration and frontend-facing contract correctness for history/summary.
- **Nithin:** runtime concurrency measurement, retry/DLQ design, and the change-stream fan-out finding.

The change-stream duplicate-dispatch finding (§1.3) affects her integration order and should be reviewed together.

---

## 4. Findings and requested decisions

### 4.1 Concurrency limitations (current)

1. Execution is synchronous inside the request, so request throughput and execution throughput are the same number.
2. No lease or ownership, so a dead run is indistinguishable from a live one.
3. Event-triggered dispatch multiplies with instance count — horizontal scaling would currently duplicate work.
4. No change-stream resume token, so events during a restart window are lost.
5. The rate limiter is per-process in memory: 100 requests / 15 min will cap any HTTP-level concurrency test long before the runtime becomes the limit.

### 4.2 Existing capabilities worth stating plainly

Optimistic update guard, compensation checkpoints with separate error reporting, enforced per-node timeout with late-settlement handling, retry/timeout shape validation with payload stripping, tenant-scoped queries throughout, and a working live-update WebSocket fan-out.

### 4.3 Smallest safe fixes before 10 November

| Fix | Owner | Approval needed |
|---|---|---|
| Document the non-retryable contract explicitly in `docs/backend/execution-contract.md` | Nithin | no — docs only |
| `index.ts` binds `localhost`; containers need `0.0.0.0` via an env var | Saransh (AWS audit) | yes — code change |
| Add `attempts` / `lastErrorCode` / `deadLetteredAt` schema fields with no behaviour change | Nithin | yes — D2 |
| Change-stream single-consumer claim (or documented single-instance constraint) | Nithin | yes — architecture |

### 4.4 Deferred, explicitly

Worker or queue infrastructure, distributed leases, idempotency keys, a separate dead-letter collection, retry of side-effecting actions, compensation replay, and any horizontal-scaling work.

### 4.5 ECS dependencies

Replica set (required for change streams), pool sizing, a single-consumer strategy for the watcher, health endpoint reachable on the container interface, and rate-limit state that is not per-process.

---

## 5. References

- `backend/src/routes/execution.routes.ts`
- `backend/src/services/execution.service.ts`
- `backend/src/services/execution.runtime.ts`
- `backend/src/services/changeStreamWatcher.service.ts`
- `backend/src/models/WorkflowExecution.ts`
- `backend/src/config/database.ts`, `backend/src/index.ts`, `backend/src/app.ts`
- `backend/src/middleware/rateLimit.middleware.ts`
- `backend/scripts/benchmark-execution-concurrency.ts`
- `docs/backend/week3-retry-failure-persistence.md` (D1/D3 decisions)
- `docs/verification/2026-11-03-nithin.md` (baseline)
- `docs/backend/execution-contract.md`, `docs/workflow-graph-contract.md`
