# Workflow Execution Verification Report

**Date:** 26 October 2026
**Project:** Multi-Tenant Distributed Workflow & Saga Orchestration Engine
**Branch:** member/mahak

## Verification Results

| Check | Result | Evidence |
|---|---|---|
| Backend automated tests | Passed | 209 passed, 0 failed or skipped |
| Backend build | Passed | Build completed successfully |
| Frontend build | Passed | Build completed successfully |
| Frontend lint | Passed with warnings | 0 errors, 2 warnings |
| Backend health endpoint | Passed | HTTP 200; status `ok` |
| Workflow execution | Passed | Test execution completed successfully |
| Execution persistence | Passed | Execution remained readable after backend restart |
| Temporary tenant workflow listing | Passed | HTTP 200; empty workflow list |
| Temporary tenant access to existing execution | Passed | HTTP 404 |
| Temporary tenant execution history | Passed | HTTP 200; empty execution list |

## Scope and Limitations

- The workflow execution test used a trigger and an unconfigured task node. It verifies basic execution traversal, not external task integrations.
- Tenant isolation results cover only the read endpoints tested above.
- Temporary tenant and API-key cleanup is still pending.
- No claim is made that every execution path or tenant-isolation scenario has been verified.


## Next Steps

1. Complete cleanup of the temporary tenant and its API key.
2. Verify the original `local-dev` tenant and its existing data remain unchanged.
3. Record the final cleanup results.

## Backend verification audit — 3 November 2026

### Scope and Git baseline

This audit describes the assigned branch only. Inspection was performed on
`member/mahak` at `43e8b99` (`docs: record WebSocket QA integration evidence`).
After fetching the requested remote refs, `origin/member/mahak` pointed to the
same commit and `origin/main` pointed to `9f5e333`. The assigned branch is an
ancestor of `origin/main` and is 20 commits behind it. No branch switch, merge,
rebase, cherry-pick, staging, commit, or push was performed.
Source-only comparison of the newer ref also found execution idempotency and
recovery changes, in addition to global execution history/summary and frontend
monitoring updates. Those newer behaviors are not claimed for this branch.

The initial and pre-documentation worktree checks showed no tracked or staged
changes. The only untracked paths were the seven files explicitly listed as
preserved in the task request; none was opened for modification, staged, or
deleted. Source-code changes were not made.

The evidence labels below describe the current branch's code and in-repository
tests. A passing test/build is not live MongoDB, production, deployment, or
performance evidence. The full WebSocket manual checklist remains **NOT RUN**.

### Verification commands actually run

| Command | Result |
|---|---|
| `backend`: `npm test` | **374 passed, 0 failed, 0 skipped; exit 0** |
| `backend`: `npm run build` | **Passed; exit 0** |
| `frontend`: `..\backend\node_modules\.bin\tsx.cmd --test tests\*.test.ts` | **78 passed, 0 failed, 0 skipped; exit 0** |
| `frontend`: `npm run build` | **Failed; exit 2** — `src/pages/ExecutionsPage.tsx` references `sanitizeErrorMessage` and `getErrorText` without importing them (7 TypeScript diagnostics). Both helpers are exported from `src/executionHelpers.ts`. |
| `frontend`: `npm run lint` | **Exit 0; 2 warnings, 0 errors** — `react(only-export-components)` in `src/theme/ThemeContext.tsx` and `react(set-state-in-effect)` in `src/pages/ExecutionsPage.tsx`. |

These are local automated checks. No standalone development/production server,
shared/live database, Atlas, production service, or manual WebSocket flow was
used. The backend suite's route/service tests use in-process servers and
injected dependencies; the WebSocket integration test uses in-memory
persistence.

### Backend area verification

| Area | Routes and contract (current `member/mahak`) | Implementation, model, auth and tenant scope | Relevant automated tests and status |
|---|---|---|---|
| Authentication and tenant context | Protected workflow, execution and ticket routes accept `x-api-key`/`X-API-Key`. Missing, unknown, revoked, expired, or inactive-tenant credentials return `401 { error: { code: "UNAUTHORIZED", message } }`. No client tenant identifier establishes authorization. | `tenantAuth.middleware.ts` resolves through `tenantResolver.ts`; API keys are SHA-256 hashed and looked up in `ApiKeyModel`, then active `TenantModel` is checked. Trusted request context contains the persisted tenant ObjectId. All workflow/execution service queries shown below include it. CORS allows `x-api-key`. The older `/api/test-tenant` endpoint still uses the separate development-only middleware. | `middleware/tenantAuth.middleware.test.ts`: `does not trust a client-supplied x-tenant-id`, `rejects a missing API key`, `rejects an invalid API key`, `attaches the resolved tenant context for a valid key`; `routes/multiTenantIsolation.test.ts`: key resolution and cross-tenant workflow/execution access cases. **VERIFIED** for the tested REST paths; not a production identity-policy or live-database certification. |
| Workflow create/list/read/update/delete and lifecycle | Mounted under `/api/workflows`: `POST /`, `GET /`, `GET /:workflowId`, `PATCH /:workflowId`, `PUT /:workflowId/graph`, `DELETE /:workflowId`, and `POST /:workflowId/{activate,pause,resume}`. Create body is `{ name, description?, graph }`; list returns `{ message, workflows }`; create/update/read/status return `{ message, workflow }`; delete returns `{ message }`. New records start `draft`, version `1`; lifecycle states are `draft`, `active`, `paused`. | `workflow.routes.ts` → `workflow.service.ts` → `WorkflowModel` (`tenantId`, name, description, status, version, graph, timestamps). Reads, writes and deletes filter by `_id` and authenticated tenant. Listing filters by tenant and sorts `createdAt` descending. PATCH accepts only name/description/graph; status is controlled by lifecycle routes. Graph and metadata updates increment version. | `routes/workflow.routes.test.ts`: `creates a workflow using the trusted tenant context`, `lists workflows using the trusted tenant even when a tenantId query is supplied`, `updates the graph using the authenticated tenant context`, `rejects client-supplied tenantId, status, and version`, activation/pause/resume and delete cases; `routes/multiTenantIsolation.test.ts`: `Tenant B cannot retrieve, update, or delete Tenant A's workflow by supplying its ID`; `services/workflow.service.test.ts` covers tenant-scoped service operations. **VERIFIED** for these route/service tests; no deployed REST test. |
| Workflow graph validation | Applied on create, PATCH graph updates, `PUT /:workflowId/graph` (body must contain only `graph`), and activation/resume. Validation errors return `400 { error: { code: "VALIDATION_ERROR" or "INVALID_WORKFLOW_GRAPH", message, details? } }`. | `workflow-graph.validator.ts`, `event-contract.validator.ts`, and `workflow.validator.ts` validate version 1, nodes/edges, exactly one trigger, types, positions, IDs/endpoints, cycles, condition branches/configuration, and event-trigger configuration. | `validators/workflow-graph.validator.test.ts` includes `rejects a directed cycle`, `rejects duplicate node IDs`, `rejects an edge with a missing target`, `rejects a graph with no trigger`, and condition-branch tests; workflow validator and service tests also cover invalid graphs. **VERIFIED** for validator and route/service automation. |
| Execution start and history | `POST /api/workflows/:workflowId/executions` accepts optional JSON-object `{ input }`; invalid input returns 400. It returns HTTP 200 with `{ message, execution: { id, workflowId, workflowVersion, status, currentNodeId, nodeResults, error, startedAt, completedAt, createdAt } }`, including a failed terminal execution as a domain result. `GET /api/workflows/:workflowId/executions?limit=&cursor=` returns `{ message, executions, pagination: { limit, hasMore, nextCursor } }`; default limit 20, allowed 1–100, sort is `_id` descending. | `execution.routes.ts` → `execution.service.ts` → `WorkflowExecution` and tenant-scoped `WorkflowModel`. Start checks that the workflow belongs to the authenticated tenant, snapshots its graph/version, persists `queued` then `running`, and executes synchronously in the request. History query filters by tenant and workflow. | `routes/execution.routes.test.ts`: `executes a workflow using the authenticated tenant and forwards input`, `passes history pagination parameters to the service`, `returns 400 for a malformed workflow ID`; `services/execution.service.test.ts`: `executes and persists the final execution for the trusted tenant`, `paginates history and returns a cursor when more records exist`, `does not create an execution for a workflow outside the tenant scope`. **VERIFIED** for the synchronous/injected test path; live persistence and asynchronous/worker execution are not verified or implemented. |
| Execution details and node persistence | `GET /api/executions/:executionId` returns `{ message, execution }`; service returns the tenant-scoped persisted document. Missing and cross-tenant IDs return the same `404 EXECUTION_NOT_FOUND`. History items contain persisted execution records. | `WorkflowExecution` persists tenant/workflow IDs, workflow version, graph snapshot, status, `currentNodeId`, node results, execution error, started/completed timestamps and Mongoose timestamps. Node results can persist node ID/status/output/error and compensation status/timestamps/error. The execution request input is **not** persisted. `currentNodeId` is initialized to null and no regular node-progress update is made; node results are available at terminal state and compensation checkpoints. Detail/history return the full tenant-owned lean record (including graph snapshot/tenant ID); the start response is an explicit, narrower projection. | `routes/execution.routes.test.ts`: `returns all defined Saga execution statuses and separates original and compensation errors`, `retrieves legacy execution details without compensation metadata`, `does not return another tenant's execution details or compensation metadata`; service tests cover tenant-scoped retrieval and checkpoint persistence. **PARTIAL**: terminal results and compensation are persisted/tested; no persisted input, per-node execution timestamps, or continuously updated current node. |
| Dashboard summary and analytics | There is no dashboard, admin, metrics, or analytics route in this branch's `backend/src`. `GET /api/health` is unauthenticated and returns only `{ status: "ok" }`. | `DashboardPage.tsx` computes local workflow totals by status from the app's workflow state; it has no execution-statistics request or backend aggregation. `TenantModel` has name/slug/status, not quota/usage fields. No worker-latency source or failure-heatmap aggregation exists. | No backend aggregation route/test exists. `frontend/tests/workflowState.test.ts`: `calculates status counts accurately for dashboard metrics`, `handles empty workflow lists gracefully without exceptions`; these test local state only. **NOT IMPLEMENTED** for execution analytics/admin monitoring. |
| Filtering, sorting and pagination | Workflow list has no query filters, search, server pagination or sort parameter; service always returns all tenant workflows ordered by `createdAt` descending. Execution history supports only `limit` and `cursor`; no status/date/execution-ID filter or caller-selected sort. | Filtering in the current workflow catalog is client-side by name/description and status. Execution history is one workflow at a time; the backend's cursor is `_id < cursor`, sorted `_id` descending. | `workflowStatusAndLifecycle.test.ts`: `normalizes backend lowercase status strings accurately` and `batch maps multiple backend records with various statuses` cover status mapping, not catalog filter behavior; `execution.routes.test.ts`: `passes history pagination parameters to the service`; `execution.service.test.ts`: `paginates history and returns a cursor when more records exist`. No page-level filter contract test was found. **PARTIAL**: the current UI's in-memory filters work over fetched data, but backend query features are absent. |
| WebSocket ticket and event delivery | `POST /api/executions/ws-ticket` requires API key and returns `{ ticket, expiresAt }`. Socket path is `/ws/executions?ticket=...`; invalid/reused/expired tickets close with 4401. Events are `{ type, data: { executionId, workflowId, status, updatedAt } }`; event types are `execution.updated`, `execution.completed`, and `execution.failed`. `queued`, `running`, `compensating`, `completed`, and `failed` are mapped; compensated statuses have no mapping. | `executionTicket.service.ts` issues 32-byte base64url, 60-second, single-use tickets held in process memory, bound to authenticated tenant. `executionWebSocket.ts` attaches to the existing HTTP server, fans out by tenant, and removes failed sockets. `execution.service.ts` notifies after confirmed persistence; failures do not roll back execution. Frontend fetches a fresh ticket on reconnect, applies exponential reconnect delays capped at 30 seconds, and refreshes REST history. | `executionWsTicket.routes.test.ts` auth/binding cases; `executionTicket.service.test.ts` expiry/reuse cases; `executionWebSocket.test.ts` tenant delivery/event mapping; `executionRealtime.integration.test.ts` uses in-memory persistence; `execution.service.test.ts` persistence-before-notify cases. **PARTIAL**: full automated suite passed, but no live DB/deployed/manual flow; tickets are single-process, events are best effort, and the frontend parser accepts event-name/status combinations without enforcing their pairing. |
| Event-trigger and Change Stream | No REST route for inserting business events is exposed in the inspected route set. A Change Stream watches inserts to `business_events`; matching active workflows for that event tenant are dispatched. | `changeStreamWatcher.service.ts` validates event, source, name and filter, checks tenant equality, and serializes dispatch through an in-memory promise queue. Startup follows DB connection; shutdown closes stream and waits for queued work. | `changeStreamWatcher.service.test.ts`: `dispatches valid matching insert events to the correct workflow`, `strictly enforces tenant isolation: cross-tenant workflows are never dispatched`, `ensures failure in one workflow execution does not block others or crash the watcher`, `processes change events strictly sequentially with controlled promises`. **PARTIAL**: core insert dispatch is unit-tested; no persisted resume token, offline replay, auto-reconnect, durable queue, deduplication, or dispatch retry. |
| Saga compensation | Compensation is part of execution; status values include `compensating`, `compensated`, `compensation_failed`. It is not a separate REST operation. | `execution.runtime.ts` selects completed compensable tasks and invokes compensation in reverse completion order; `execution.service.ts` persists checkpoints before/after compensation. Original task errors remain separate from per-node compensation errors. | `execution.service.test.ts`: `compensates a completed task after the next task fails and persists checkpoints`, `compensates eligible tasks in reverse task-completion order`, `preserves task errors separately from compensation errors`, `records multiple compensation failures without replacing the task error`, `does not call compensation when its pre-handler checkpoint fails`. **VERIFIED** for isolated runtime/service tests; no live MongoDB or crash-recovery proof. |
| Retry and dead-letter queue | No retry route or DLQ route/worker exists. A task may declare `{ attempts, backoffMs }`, but this is configuration validation only. | `execution.runtime.ts` validates the retry shape and strips `retry`/`timeoutMs` from the handler payload; it does not repeat failed actions. Execution remains synchronous and single-shot. No retry-attempt record, backoff scheduler, DLQ persistence or worker exists. | `execution.service.test.ts`: `does not retry a failed task when the node declares a retry policy`, `dispatches each task exactly once per execution when a later task fails`, `keeps retry and timeoutMs out of task and compensation payloads`. **NOT IMPLEMENTED** for retry execution/DLQ. |
| Administrative monitoring | No `/api/admin/*` route or metrics collector is present. No admin authorization role/guard is present in the route set. | No quota fields in `TenantModel`; no persisted worker-latency or failure-heatmap source. The workflow dashboard's local counts are not admin metrics. | No relevant backend tests. **NOT IMPLEMENTED**. |

### Frontend/backend contract matrix

| Surface | Frontend expectation/current behavior | Backend actual behavior on assigned branch | Contract result and impact |
|---|---|---|---|
| Dashboard | `DashboardPage.tsx` shows total, active, draft and paused workflow counts and recent workflows. It does not call an analytics API, show execution totals/success/failure, or render execution charts. | No dashboard/analytics endpoint; workflow records are the only source used by the current page. | Workflow counts are local state, not backend aggregates. Execution/admin metrics and unavailable-data handling have no current contract. |
| Workflow catalog | `WorkflowsPage.tsx` fetches `GET /api/workflows`, filters name/description and status locally, and has no page/sort control. | `GET /api/workflows` accepts no query options; returns all authenticated-tenant workflows sorted by `createdAt` descending. Supports status values `draft`, `active`, `paused`. | Search/filter UX is client-side and currently needs the full list. No backend search, filter, pagination, or selectable sort exists. Empty list is `200` with `workflows: []`. |
| Workflow studio/builder | `createWorkflow` sends `{name, description?, graph}`. `updateWorkflow` sends `PATCH /api/workflows/:workflowId` with name/description/graph. | Both payloads are accepted and validated. `PUT /api/workflows/:workflowId/graph` also exists but is not used by this frontend. Activation/pause/resume use `POST /api/workflows/:id/{activate,pause,resume}`. Server owns tenant/status/version. | No identified create/update payload mismatch. A client cannot set `tenantId`, `status`, or `version`; graph errors return `400` with `details`. |
| Execution history | Current branch selects a saved workflow and calls `GET /api/workflows/:workflowId/executions?limit=20&cursor=...`; no status/date/search/sort controls. | Same endpoint supports limit 1–100, cursor only, newest `_id` first. Empty result is `200` with `executions: []` and pagination. No global execution list exists on this branch. | Current UI aligns with the per-workflow API, but redesigned global history/filter expectations are unsupported here. No server date/status filtering. |
| Execution details | UI displays ID/workflow/status/version/timestamps, error, node status/output/error and compensation status/timestamps/error. | These fields are persisted and tenant-scoped as described above; history/detail expose stored records. Input is not stored; current node does not advance; ordinary per-node start/end times are absent. | UI's displayed fields are supported. Any expectation to show input, continuous node progress, or per-node duration has no persisted source. |
| Analytics | Current `DashboardPage` has no analytics call. Current branch `executionApi.ts` has no global list or summary helper. | No aggregation endpoint on `member/mahak`. **Source-only remote comparison:** current fetched `origin/main` adds `GET /api/executions` (tenant-scoped global list with `workflowId`, `status`, `from`, `to`, `executionId`, `limit`, `cursor`) and `GET /api/executions/summary` (tenant/workflow/date-scoped counts: `total`, `queued`, `running`, `completed`, `failed`, `compensating`, `compensated`, `compensationFailed`, `unsuccessful`, `successRate`, `failureRate`, `avgDurationMs`). Its service calculates `unsuccessful` as `failed + compensated + compensation_failed`, so successfully compensated executions are counted as unsuccessful; product semantics need confirmation. The global list uses created-at range and descending creation-time/ID ordering. These newer endpoints have not been merged into the assigned branch or runtime-tested in this audit. | Branch is 20 commits behind; do not treat origin/main source as behavior on the assigned branch. Its summary is used in the remote `ExecutionsPage`, not the current branch's `DashboardPage`. No failure heatmap, tenant quotas, or worker latency is evidenced by the inspected summary contract. |
| Error handling | Workflow client extracts `error.message` and joins `error.details`; execution client uses `error.message` with HTTP fallback. Execution-history UI shows a generic retry message on list failure. | Validation: 400 `{ error: { code, message, details? } }`; auth: 401; missing and cross-tenant resources: 404; unexpected errors: 500 `{ error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred." } }`. There is no general 403 path for tenant-owned IDs; cross-tenant reads are concealed as 404. Empty collections are successful 200 responses. | Main error envelope is compatible. Validation details are not surfaced by execution client. Current frontend build is blocked because `ExecutionsPage.tsx` references helper exports without importing them (see verification commands). |

### WebSocket and realtime follow-up

Current source inspection confirmed route mounting in `app.ts`, ticket route
authentication, tenant-bound one-use in-memory ticket behavior, same-HTTP-server
WebSocket attachment in `index.ts`, tenant-scoped fan-out, and publication
after confirmed persistence. Unit/in-process integration tests are included in
the **374 passing backend tests** above. These do not prove live MongoDB writes,
deployed endpoint registration, or multi-instance behavior. `socket.send`
errors remove the affected socket and are swallowed; an explicit failing
transport callback was not independently exercised by the full suite. REST is
the authoritative refresh path after reconnect.

The existing [WebSocket execution updates](../docs/websocket-execution-updates.md)
manual scenarios remain **NOT RUN**. The assigned branch's
`executionRealtime.ts` does not contain the stale-socket callback guard present
in the newer `origin/main` source. The related frontend parser also does not
reject terminal event-name/status mismatches. No shared live database was
used.

### Prioritized gap report for Saransh review

No source implementation is included in this audit. Recommendations are
proposals for approval; complexity/risk describe the likely implementation
scope, not a delivery estimate.

#### Priority 1 — Mandatory project requirements missing or inadequately verified

**P1-1 — Isolated transformation-script execution**

- **Requirement / current behavior:** Week 3 requires isolated transformation execution. The expression validator/evaluator exists, but the runtime does not wire it to a built-in transform action; transform action dispatch still depends on a code-owned registry. This is not arbitrary-script sandbox evidence.
- **Evidence:** `backend/src/validators/transform-expression.validator.ts`, `backend/src/services/transform.evaluator.ts`, `backend/src/services/execution.runtime.ts`; see the existing [script-transformation isolation assessment](../docs/backend/script-transformation-isolation-assessment.md). Existing evaluator tests do not establish execution-runtime isolation.
- **Likely files:** runtime/action registry, transformation evaluator/validator, execution tests and accepted task contract.
- **Required contract change:** approve a constrained expression/action interface and enforce its input/output, resource and error bounds in the actual runtime; do not imply OS/process isolation unless provided.
- **Tenant/security implications:** treat workflow expressions and inputs as tenant-controlled; enforce strict resource limits and prevent data leakage across invocation context.
- **Tests required:** unit and workflow-level transform dispatch, invalid/boundary expressions, resource exhaustion, mutation/isolation, and tenant-context checks.
- **Complexity / risk:** High / High.
- **Recommendation:** Implement before 10 November, subject to security/design approval.

**P1-2 — Retry execution and DLQ**

- **Requirement / current behavior:** Week 3 requires configurable retries and a dead-letter queue. Retry shape validation and D1 payload stripping exist, but actions execute once; there is no durable attempt counter, backoff scheduler, DLQ or worker.
- **Evidence:** `backend/src/services/execution.runtime.ts`; `backend/src/models/WorkflowExecution.ts`; tests `does not retry a failed task when the node declares a retry policy` and `dispatches each task exactly once per execution when a later task fails`.
- **Likely files:** execution runtime/service/model, queue or worker boundary, route/result contract, retry/DLQ tests and operational configuration.
- **Required contract change:** approve retryable error classification, attempt/backoff limits, idempotency/duplicate-side-effect behavior, persisted attempt history and DLQ access/retention.
- **Tenant/security implications:** queue records, retry details and DLQ reads must be tenant-scoped; retrying non-idempotent actions can duplicate external side effects.
- **Tests required:** attempt count and delays, retryable/non-retryable classification, cancellation/timeouts, persistence failure, duplicate dispatch/idempotency, tenant-isolated DLQ retrieval.
- **Complexity / risk:** High / High.
- **Recommendation:** Implement before 10 November only after policy and idempotency approval.

**P1-3 — Administrative dashboard, quotas and operational metrics**

- **Requirement / current behavior:** Week 4 requires an administrative dashboard, tenant quota monitoring, failure heatmaps and worker latency. The assigned branch has no admin/analytics route, tenant quota fields, worker metrics, or backend aggregation; the current dashboard reports only local workflow counts.
- **Evidence:** no admin/analytics/metrics route or symbol under `backend/src`; `backend/src/models/tenant.model.ts`; `frontend/src/pages/DashboardPage.tsx`.
- **Likely files:** metrics routes/controllers/services, tenant/quota or usage model, dashboard API/client/UI and tests.
- **Required contract change:** define each metric, time range, aggregation semantics, quota source, empty-state behavior, and whether data is tenant-admin or platform-admin scoped. Do not infer metrics from charts or status labels.
- **Tenant/security implications:** platform-wide data requires explicit admin authorization; tenant-level requests must include authenticated tenant scope and must not trust a query tenant ID.
- **Tests required:** metric aggregation and date boundaries, empty data, quota accounting, role/tenant authorization and cross-tenant denial.
- **Complexity / risk:** High / High.
- **Recommendation:** Implement before 10 November after metrics and admin authorization are approved.

**P1-4 — 1,000+ execution stress evidence and deployment/worker scaling**

- **Requirement / current behavior:** Week 4 calls for 1,000+ concurrent execution stress testing, containerization and ECS/Kubernetes worker scaling. The current service executes inline in the HTTP request; there is no worker/queue implementation or Docker/Kubernetes/Bicep/Terraform manifest in the inspected workspace. Graph-validation benchmarking is not execution-load evidence.
- **Evidence:** `backend/src/services/execution.service.ts`; `backend/src/index.ts`; `backend/scripts/benchmark-graph-validation.ts`; repository file inventory.
- **Likely files:** queue/worker and execution lifecycle, deployment manifests/container build, configuration, load-test harness and operational documentation.
- **Required contract change:** agree on asynchronous start/accepted response, execution ownership/leases, queue semantics, scaling limits, health/readiness and deployment target.
- **Tenant/security implications:** workers must preserve tenant context and quotas; credentials must be scoped and not embedded in images; queue and metrics access must be tenant-safe.
- **Tests required:** staged concurrency/load test with declared workload and thresholds, failure/restart/recovery tests, container build/start smoke tests and scaling validation.
- **Complexity / risk:** High / High.
- **Recommendation:** Implement before 10 November. No load or deployment claim is made here.

**P1-5 — Live integration verification of persistence and realtime**

- **Requirement / current behavior:** Automated route/service/WebSocket tests pass, but use injected/in-memory persistence. This audit did not start an application or connect to a replica set, approved isolated MongoDB, or deployed WebSocket endpoint.
- **Evidence:** 374 backend tests passed; `executionRealtime.integration.test.ts` is in-memory by its setup; `docs/websocket-execution-updates.md` lists every manual scenario as NOT RUN.
- **Likely files:** integration test harness/configuration and, only if failures show a defect, the corresponding backend wiring.
- **Required contract change:** none until an isolated environment and fixture/cleanup policy are approved.
- **Tenant/security implications:** use only isolated test tenants and credentials; do not run writes against shared or production data.
- **Tests required:** ticket issue/connect/reuse/expiry, two-tenant delivery isolation, persisted state before event, REST refresh/reconnect, and app route registration on an isolated replica set.
- **Complexity / risk:** Medium / Medium; environment-dependent.
- **Recommendation:** Implement before 10 November, gated on Saransh approving an isolated environment; otherwise keep NOT RUN.

#### Priority 2 — Backend support required by the redesigned frontend

**P2-1 — Global execution history, filters and analytics on the assigned branch**

- **Requirement / current behavior:** Redesigned global history and summary behavior are absent from this branch. The current branch only provides per-workflow history with limit/cursor. `origin/main` contains newer source for global `GET /api/executions` and `GET /api/executions/summary`, plus frontend controls, but that code is not present on `member/mahak`.
- **Evidence:** branch `backend/src/routes/execution.routes.ts`, `backend/src/services/execution.service.ts`, `frontend/src/api/executionApi.ts`; remote-only source comparison at `origin/main` (20 commits ahead).
- **Likely files:** execution routes/service, `frontend/src/api/executionApi.ts`, `frontend/src/pages/ExecutionsPage.tsx`, contract tests.
- **Required contract change:** adopt/approve global filters `workflowId`, `status`, `from`, `to`, `executionId`, `limit`, `cursor`, stable descending creation-time/ID ordering, and summary response/status-count and duration/rate definitions. On `origin/main`, the summary response is `{ summary, filter }`; do not implement a duplicate until the branch integration is approved.
- **Tenant/security implications:** both global list and aggregation must derive tenant from API-key context and never accept an authoritative client tenant ID.
- **Tests required:** filter combinations and validation, deterministic pagination, date boundaries, aggregation correctness, empty result, and cross-tenant isolation.
- **Complexity / risk:** Medium / Medium.
- **Recommendation:** Defer duplicate work; first have Saransh review the newer `origin/main` implementation and the non-fast-forward branch delta.

**P2-2 — Dashboard execution metrics and empty/unavailable states**

- **Requirement / current behavior:** Current dashboard only counts workflow objects from local state; it does not call the remote summary endpoint or report execution counts. Even `origin/main`'s summary endpoint is used by its enhanced execution page, not the current `DashboardPage`.
- **Evidence:** `frontend/src/pages/DashboardPage.tsx`, `frontend/src/App.tsx`, branch `backend/src` route set; remote comparison only for `origin/main`.
- **Likely files:** dashboard page/API client, approved summary route/service, dashboard tests.
- **Required contract change:** decide whether dashboard needs total/active workflow counts only or execution summary metrics too, and define loading, empty, error and stale states.
- **Tenant/security implications:** use only authenticated tenant-scoped summary data; do not label local sample workflows as persisted tenant metrics.
- **Tests required:** API-driven counts, empty response, unavailable API, tenant switching and error states.
- **Complexity / risk:** Medium / Medium.
- **Recommendation:** Implement before 10 November if execution dashboard metrics are required; approve the metric definition first.

**P2-3 — Frontend build blocker**

- **Requirement / current behavior:** The frontend cannot build on this branch. `ExecutionsPage.tsx` calls `getErrorText` and `sanitizeErrorMessage` but omits their import; both already exist in `frontend/src/executionHelpers.ts`.
- **Evidence:** `npm run build` exited 2 with seven `TS2304`/`TS2552` diagnostics; `frontend/tests/themeAndExecutions.test.ts` covers the helper functions.
- **Likely files:** `frontend/src/pages/ExecutionsPage.tsx`; existing helper test file only if import behavior needs a new regression case.
- **Required contract change:** none. Proposed minimal fix is to import both existing helpers rather than duplicate them.
- **Tenant/security implications:** preserves existing error sanitization; no tenant behavior changes.
- **Tests required:** frontend build and existing helper tests; optionally a focused page-level error rendering test.
- **Complexity / risk:** Low / Low.
- **Recommendation:** Implement before 10 November, but wait for Saransh's approval as requested. No code change was made in this audit.

#### Priority 3 — Useful enhancements that can be deferred

**P3-1 — Server-side workflow catalog search/filter/pagination**

- **Requirement / current behavior:** Workflow search by name/description and status filtering run in the browser after the API returns all tenant workflows. Backend supports no list filters/page/sort inputs and always sorts by `createdAt` descending.
- **Evidence:** `frontend/src/pages/WorkflowsPage.tsx`, `frontend/src/api/workflowApi.ts`, `backend/src/services/workflow.service.ts`.
- **Likely files:** workflow route/service, API client, catalog page and route/service tests.
- **Required contract change:** if needed for scale, approve query fields, sort allow-list, cursor semantics and page response.
- **Tenant/security implications:** apply filters after trusted tenant scope; never widen query scope based on caller-provided tenant IDs.
- **Tests required:** filter/sort/page validation, stable cursor ordering, empty page and cross-tenant listing.
- **Complexity / risk:** Medium / Medium.
- **Recommendation:** Defer until tenant workflow volume or acceptance criteria require server-side search.

**P3-2 — More execution detail and per-node timing/progress**

- **Requirement / current behavior:** Persisted records do not contain execution input; ordinary task node results do not contain per-node start/end timestamps; `currentNodeId` is not advanced. The current UI does not display these absent fields. It does display persisted node output, errors, compensation state/timestamps and execution timestamps.
- **Evidence:** `backend/src/models/WorkflowExecution.ts`, `backend/src/services/execution.service.ts`, `backend/src/services/execution.runtime.ts`, `frontend/src/pages/ExecutionsPage.tsx`.
- **Likely files:** execution schema/service/runtime, response types and detail UI/tests.
- **Required contract change:** decide whether storing input is allowed (and redaction/retention), and define node timing/progress semantics before adding fields.
- **Tenant/security implications:** inputs and outputs may contain secrets/PII; tenant-scoped access, redaction and retention are required.
- **Tests required:** persisted field contract, redaction, tenant-scoped detail, legacy-record compatibility and timing transitions.
- **Complexity / risk:** Medium / High.
- **Recommendation:** Defer until the detail UI explicitly requires these fields and data-retention policy is approved.

**P3-3 — Durable Change Stream recovery and multi-instance realtime**

- **Requirement / current behavior:** Change Stream insert dispatch and WebSocket delivery exist, but there is no persisted resume token, offline replay, automatic Change Stream reconnection, durable dispatch queue, event deduplication, cross-instance pub/sub, or durable ticket store. Event delivery is best effort.
- **Evidence:** `backend/src/services/changeStreamWatcher.service.ts`, `backend/src/services/executionTicket.service.ts`, `backend/src/services/executionWebSocket.ts`; [event contract](../docs/backend/event-contract.md).
- **Likely files:** watcher persistence/recovery, queue/outbox, WebSocket ticket/pub-sub service, deployment and integration tests.
- **Required contract change:** decide at-least-once/exactly-once expectations, replay window, idempotency key and multi-instance delivery semantics.
- **Tenant/security implications:** resume/replay state and fan-out subscriptions must remain tenant-bound; deduplication keys must not collide across tenants.
- **Tests required:** restart/replay, resume-token expiry, duplicate event, transient disconnect, multi-instance fan-out and tenant-isolation cases.
- **Complexity / risk:** High / High.
- **Recommendation:** Defer until delivery guarantees and the worker/deployment architecture are approved.

**P3-4 — Tighten frontend realtime event validation**

- **Requirement / current behavior:** The parser accepts any supported status with any of the three allowed event names. It does not enforce that `execution.completed` carries `completed` or `execution.failed` carries `failed`. Initial queued creation is not published; compensated terminal states are obtained by REST refresh.
- **Evidence:** `frontend/src/api/executionRealtime.ts`, `backend/src/services/executionWebSocket.ts`, `frontend/tests/executionRealtime.test.ts`.
- **Likely files:** frontend event parser and realtime tests; backend mapping only if the team approves a new event contract.
- **Required contract change:** decide explicit status/event combinations and whether queued/compensation terminal events should be emitted.
- **Tenant/security implications:** malformed/stale messages must not overwrite more recent REST state; retain tenant-bound sockets.
- **Tests required:** valid and mismatched terminal pairs, late/stale event ordering, reconnect REST reconciliation and new event mappings.
- **Complexity / risk:** Low / Medium.
- **Recommendation:** Defer until the event contract is approved; REST remains authoritative.

### Approval boundary

This audit is evidence for review, not implementation authorization. The
frontend import issue is a small proposed fix, but was intentionally left
untouched. Large retry/DLQ, transformation, metrics, worker, deployment, and
recovery work should be prioritized and approved by Saransh before coding.

## Follow-up investigation after remote refresh — 3 November 2026

This addendum supersedes earlier remote-reference counts and remote-frontend
observations above. It records source comparison only; it does not change the
assigned branch's implementation status or claim runtime verification on
`origin/main`.

### Git and preservation boundary

- Current branch and `HEAD`: `member/mahak`, `43e8b99`.
- `origin/member/mahak`: `43e8b99`.
- Fetched `origin/main`: `dde30bc` (merge of PR #96, containing
  `b6a0f75`, the enterprise light-theme dashboard redesign).
- `git rev-list --left-right --count origin/main...member/mahak`: `22 0`.
  The assigned branch is an ancestor of the fetched main; it has no committed
  branch-only commits. The two commits newer than the earlier `9f5e333`
  snapshot are the redesign commit and its merge.
- The four pre-existing modified documentation files, seven specified
  untracked files, and `stash@{0}` remain preserved. No application source was
  edited; no file was staged, committed, pushed, switched, merged, or rebased.
- The implementation and remote test sources described below were inspected
  from Git refs. They were not checked out or executed. No shared/live database
  or deployment environment was used.

### Reproduced frontend build failure

The assigned-branch frontend build reports seven TypeScript diagnostics, all
in `frontend/src/pages/ExecutionsPage.tsx`:

| Line | Diagnostic |
|---|---|
| 77 | `TS2304: Cannot find name 'sanitizeErrorMessage'.` |
| 457 | `TS2552: Cannot find name 'getErrorText'. Did you mean 'errorText'?` |
| 618 | `TS2304: Cannot find name 'getErrorText'.` |
| 620 | `TS2304: Cannot find name 'getErrorText'.` |
| 637 | `TS2304: Cannot find name 'getErrorText'.` |
| 639 | `TS2304: Cannot find name 'getErrorText'.` |
| 671 | `TS2304: Cannot find name 'sanitizeErrorMessage'.` |

`frontend/src/executionHelpers.ts` exports both named helpers:
`sanitizeErrorMessage(message: string): string` and
`getErrorText(error: WorkflowExecution['error']): string`. The proposed
minimal import is:

```ts
import { getErrorText, sanitizeErrorMessage } from '../executionHelpers'
```

The import is absent in the assigned-branch page. The helpers and import are
present in the fetched `origin/main` execution page; this comparison does not
establish that the redesign build passes. No fix was applied because the
approved follow-up scope is investigation/documentation only.

### Execution APIs and contract evidence on fetched `origin/main`

Commit `406bacf5728963b23b5668bc9e8f0ca83c7ef456` added the global execution
history and summary APIs, their frontend clients, and route/service tests.
Commit `50417e0da85abd3bbb6ade7c8e54d5309a1e1ed3` subsequently hardened
idempotency reservation fencing and added abandoned-execution recovery. These
implementations are in fetched main, not in the assigned branch at `43e8b99`.

The latest main source still mounts `GET /api/executions` and
`GET /api/executions/summary` behind tenant authentication:

| Endpoint | Verified source contract on `origin/main` | Status on `member/mahak` |
|---|---|---|
| `GET /api/executions` | Query: `workflowId`, `status`, `from`, `to`, `executionId`, `limit`, `cursor`. The service validates values, defaults `limit` to 20 and caps it at 100, filters by authenticated tenant and created-at range, and orders by `createdAt` then `_id` descending for cursor pagination. Response contains a message, executions, and pagination cursor data. | `BLOCKED` — the current branch lacks the global route/service contract; the implementation is on fetched main and integration is not approved by this investigation. |
| `GET /api/executions/summary` | Query: `workflowId`, `from`, `to`; tenant scope is taken from authenticated context. Response is `{ summary, filter }`. Summary fields include `total`, seven lifecycle status counts, `unsuccessful`, `successRate`, `failureRate`, and `avgDurationMs`. Empty counts/rates are zero and unavailable average duration is null. The service uses persisted execution data and excludes invalid/missing duration timestamps from its average. | `BLOCKED` — this route is absent on the current branch; main source and its tests are not runtime evidence for this branch. |

`WorkflowExecution` gains a tenant/created-at compound index in the analytics
commit. Route tests on main cover missing/invalid API keys, tenant scoping,
summary query validation, pagination forwarding, and route collision cases.
Service tests cover seven status filters, workflow/execution-ID/date filters,
cursor validation, tenant-scoped summaries, and invalid ranges. These test
files were inspected but not run here. The success metric's source policy
counts `failed + compensated + compensationFailed` as unsuccessful and uses
completed plus unsuccessful terminal records as its rate denominator; keep
that policy explicit for product approval rather than treating compensation
success as an unambiguous user-facing failure.

### Latest redesigned frontend contract comparison

PR #96 adds `AnalyticsPage` and connects the redesigned Dashboard and
Executions pages to the global APIs. These are source-level findings on
`origin/main`, not functionality available from the assigned branch:

- `DashboardPage` loads saved workflows, the tenant summary, the newest six
  global executions, and up to five `failed` records using the API clients.
  KPI values are derived from those responses; each request has loading,
  unavailable/error, and empty-data handling. It explicitly labels historical
  execution volume **“Trend unavailable”** rather than drawing a fabricated
  time series.
- `AnalyticsPage` loads the same summary API and saved workflows for filters.
  It passes workflow, `from`, and `to` filters to the summary endpoint and
  derives status distribution, terminal outcomes, active count, and average
  duration from the returned summary. Its P95/P99 section explicitly says
  these values are withheld because the backend does not calculate them.
  Source inspection found no production mock metrics on these pages.
- The redesigned `ExecutionsPage` sends supported workflow, status, date,
  execution-ID, limit, and cursor filters to the global history API and uses
  the summary endpoint for filtered summary data. This matches the main
  backend source contract; it cannot work against the assigned branch until
  that API implementation is approved and integrated.
- The redesigned workflow catalog fetches the tenant's complete
  `GET /api/workflows` result and applies name/description search, status
  filtering, and updated/name sorting client-side. The backend list route
  accepts no search, status, sort, or pagination parameters and returns the
  tenant's records ordered by creation time descending. The UI controls
  therefore do not imply server-side search or pagination; catalog scale
  limits remain unspecified.
- Main's added frontend tests include `frontend/tests/analyticsPage.test.ts`,
  `dashboardPageRender.test.ts`, `executionEnterpriseSuite.test.ts`, and
  `workflowCatalog.test.ts`. Their source was inspected only. The build,
  tests, and live requests on `origin/main` were not run.

The implementation audit's existing result for this checkout remains:
backend tests 374/374 and backend build passed; frontend tests 78/78 passed;
frontend lint exited successfully with two warnings; frontend build failed
with the seven diagnostics above. These are results from the assigned
checkout, not from fetched main.

### Realtime comparison

The two commits added after the earlier `9f5e333` snapshot do not change
backend WebSocket ticket or event-delivery source. The fetched main does
contain a newer frontend realtime client than the assigned branch:
`frontend/src/api/executionRealtime.ts` adds optional connection-status
notifications and guards callbacks from stopped or superseded sockets.
`frontend/tests/executionRealtime.test.ts` is present on main. This is a
source difference only; tests were not run. Ticket issuance, expiry/reuse,
tenant binding, approved connection mechanism, event payloads, and server
send/persistence ordering remain as recorded in the existing WebSocket audit.
The WebSocket manual scenarios WS-01 through WS-10 remain **NOT RUN**.

### Prioritized follow-up plan (approval required before implementation)

The “before 10 November” recommendations below are priorities against the
project brief, not approval to edit application code. **Saransh's approval is
required before implementation or branch integration.**

#### Priority 1 — mandatory project requirements

| Gap / current evidence | Likely files and contract work | Isolation/security, tests, complexity and risk | Recommendation |
|---|---|---|---|
| Retry and DLQ execution remain unverified/incomplete on the assigned branch. Retry-related configuration is validated and orchestration-only fields are stripped; no retry execution or durable DLQ flow was evidenced. Main's idempotency/recovery additions are not retries or DLQ. | `backend/src/services/execution.runtime.ts`, `execution.service.ts`, `WorkflowExecution.ts`, route/schema files, and retry/DLQ tests. Define attempt limits/backoff, terminal vs retryable errors, persistence, replay/dead-letter APIs, and idempotency interactions. | Preserve tenant ownership in every retry/replay query; prevent duplicate side effects. Add deterministic retry, exhaustion, persistence/restart, replay-auth, and cross-tenant tests. **High complexity / High risk.** | **Implement before 10 November**, after Saransh approves the retry/DLQ semantics and API. |
| Transformation validation/evaluation exists but no production runtime handler wires it into execution; a registry dispatch is not a sandbox. Isolation is not verified. | Runtime transform handler, graph validator, transform evaluator, sandbox/dependency boundary, tests, and the preserved transformation assessment/design docs. Define permitted language, resources, timeout, input/output limits, and failure behavior. | Treat arbitrary script execution as a security boundary; prove tenant data separation and resource limits. Add adversarial isolation, timeout, serialization, and tenant-leak tests. **High / High.** | **Implement before 10 November** only after Saransh approves a concrete isolation design; otherwise block execution of untrusted scripts. |
| Admin/operations requirements are only partially addressed. Main's redesign has tenant-scoped execution KPIs and summary analytics, but source inspection shows no cross-tenant admin metrics, quotas, worker-latency or failure-heatmap aggregation. A historical volume chart is explicitly unavailable. | Admin authorization and aggregation routes/services/models; Dashboard/Analytics contract; quota policy; worker and queue instrumentation. Define metric windows, roles, units, and aggregation cost. | Do not expose cross-tenant data through tenant API keys; add role-boundary and isolation tests. Add aggregation correctness and empty-data tests. **High / High.** | **Implement before 10 November** for explicitly mandatory admin/operations metrics, after requirements and authorization are approved; defer optional visualizations. |
| Required scale/deployment verification is not evidenced by this code audit. The 1,000-concurrent-execution target and deployment readiness need a defined environment and workload; source inspection alone cannot establish either. | Load-test scenarios/scripts, queue and database capacity configuration, deployment/IaC and CI as applicable. Define concurrency duration, latency/error thresholds, dataset, and safe isolated environment. | Use a non-production isolated environment and synthetic tenant data. Tests must report achieved concurrency, queue saturation, latency, and error rates. **High / High.** | **Implement before 10 November** only if a safe environment and measurable acceptance thresholds are approved; otherwise mark blocked, not passed. |
| WebSocket manual acceptance remains outstanding despite source and automated-test evidence. | Existing WebSocket runbook and tests; execute WS-01–WS-10 after approved isolated environment is available. | Verify tenant-bound tickets, expiry/reuse, auth, payloads, disconnect/reconnect, stale events, and REST reconciliation without a shared live database. **Medium / Medium.** | **Implement/verify before 10 November** when a safe test environment is approved. All ten scenarios remain NOT RUN until then. |

#### Priority 2 — redesigned frontend support

| Gap / current evidence | Likely files and contract work | Isolation/security, tests, complexity and risk | Recommendation |
|---|---|---|---|
| The assigned branch does not contain global execution listing/summary contracts used by redesigned Dashboard, Analytics, and Executions pages. Those API implementations exist on fetched main, but are not part of this checkout. | Review/integrate `backend/src/routes/execution.routes.ts`, `execution.service.ts`, `WorkflowExecution.ts`, `frontend/src/api/executionApi.ts`, and the three pages as a coherent approved change. Do not duplicate the remote implementation. | Re-run tenant isolation, cursor/filter, aggregate semantics, API compatibility, and UI tests after integration. **Medium / High** due to execution history, schema/index, and frontend overlap. | **Implement before 10 November** by approval-based integration/review of existing main commits, not a second implementation. |
| Current-branch frontend build is blocked by the seven missing helper-name diagnostics. Both helper implementations and tests already exist; the main page imports them. | `frontend/src/pages/ExecutionsPage.tsx`; existing `frontend/src/executionHelpers.ts` and `frontend/tests/themeAndExecutions.test.ts`. Add only the two named imports after owner approval. | No backend or tenant-isolation change. Run the existing helper/execution tests and frontend build; verify no other diagnostics. **Low / Low.** | **Implement before 10 November** as a frontend-owner fix; it was intentionally not applied in this investigation. |
| Workflow catalog search/status/sort are client-side over the full tenant workflow list; backend does not provide search/sort/pagination parameters. | `frontend/src/pages/WorkflowsPage.tsx`, workflow API/routes/service. Add query contract only if catalog size or response-size needs require server-side operations. | Maintain tenant scoping; validate sort allowlist and page cursors. Test filters against large and empty tenant datasets. **Medium / Medium.** | **Defer** unless product requires server-side pagination before release; current UI filtering operates on the fetched tenant list. |
| Dashboard execution-volume time series and P95/P99 are not supplied by current aggregation APIs. The latest UI correctly shows trend unavailable and withholds percentiles. | Analytics aggregation service/model and Dashboard/Analytics pages, if these metrics are approved. Specify bucket interval, timezone, percentile computation and query bounds first. | Bound aggregation costs and keep tenant match first; test boundary dates, empty buckets, and percentile correctness. **Medium / High.** | **Defer** until a product requirement and acceptable aggregation cost are approved; do not fabricate chart values. |

#### Priority 3 — enhancements to defer

- Server-side workflow search/sorting/pagination and additional catalog indexes:
  useful at larger tenant scale, but not evidenced as a release blocker.
- Historical trend, P95/P99, worker-latency and richer failure-distribution
  visualizations: defer until metrics definitions and data sources are approved.
- Further realtime events beyond the existing documented status contract:
  defer until product approves event names, payloads, and REST reconciliation
  behavior.

### Integration decision and evidence limits

PR #96 and the global execution API work are present on fetched main; there are
zero committed changes unique to `member/mahak`. However, the assigned checkout
has local documentation edits (including shared WebSocket/report files), the
seven preserved untracked files, and a stash. Those local items must remain
untouched during any later integration. No branch integration was performed
here. The findings and proposed work should be shared with Saransh and the
frontend owner before any code changes.

## Branch/API verification and backend gap update — 5 November 2026

This update supersedes earlier remote-reference counts and branch/API
comparisons above. It records source inspection separately from tests actually
run in the assigned checkout. Remote-ref source and test files were inspected
read-only; they were not checked out or executed. No live database, deployed
service, manual WebSocket flow, or load test was used.

### A. Starting Git state and branch comparison

| Point | `HEAD` / `origin/main` / `origin/member/mahak` |
|---|---|
| Starting local branch and `HEAD` | `member/mahak`, `eecb7ef8273ac87915014df0b1a52f6a69e167b8` |
| Remote refs before fetch | `origin/main` `dde30bc7d3e1e548ad34df292724277b3590db24`; `origin/member/mahak` `eecb7ef8273ac87915014df0b1a52f6a69e167b8` |
| Fetched refs after read-only fetch | `origin/main` `bd7cad62857445f80c91c83763a13751e33a155f`; `origin/member/mahak` `e6cfd17e9fe599803bed928807a5f6321dc04dd0` |

At the start, there were no tracked or staged changes. The seven untracked
files listed in the 5 November task instructions were present and preserved.
The existing stash was preserved:
`stash@{0}: On member/mahak: temp: preserve Mahak websocket verification documentation`.
After fetching, the local branch remained at its starting `HEAD`; it is 25
commits behind `origin/member/mahak`.

| Comparison (`git rev-list --left-right --count`) | Left-only | Right-only | Interpretation |
|---|---:|---:|---|
| `origin/main...member/mahak` | 36 | 0 | The local assigned branch is 36 commits behind main and has no commits absent from main. |
| `origin/main...origin/member/mahak` | 11 | 0 | The fetched member ref is 11 commits behind main and has no commits absent from main. |
| `member/mahak...origin/member/mahak` | 0 | 25 | The local checkout is 25 commits behind its fetched member ref. |

The branch is not divergent from main at the recorded refs. There are no
current member-only commits or files to cherry-pick. This does not mean that
the branch work was authored only on main: the following Mahak-authored
documentation work is reachable from main and remains in its history:

| Commit | Author / subject | Changed files |
|---|---|---|
| `eecb7ef8273ac87915014df0b1a52f6a69e167b8` | Mahak Kahar — `docs: update backend verification and integration gap analysis` | `backend/WORKFLOW_VERIFICATION_REPORT.md`; `docs/backend/week3-retry-failure-persistence.md`; `docs/websocket-execution-updates.md`; `docs/workflow-api-auth-contract.md` |
| `43e8b99cda7bebb65454440ec1ddc33e0879c0f8` | Mahak Kahar — `docs: record WebSocket QA integration evidence` | `docs/websocket-execution-updates.md` |
| `e7d489e5b7b3c2dcedc13d96f33a2cbe2bdfb20d` | Mahak Kahar — `docs: reconcile WebSocket implementation and QA evidence` | `docs/websocket-execution-updates.md` |
| `bd2775c33179b9363f99e7052b8193d3a5b0d8d7` | Mahak Kahar — `docs: complete Week 3 execution and QA documentation` | `docs/architecture.md`; `docs/backend/week3-retry-failure-persistence.md`; `docs/websocket-execution-updates.md`; `docs/workflow-api-auth-contract.md` |

The WebSocket implementation commit
`27300f2a70466ec1843646c7d5c7d48e41de883f` was authored by Nithin
(nithin07-source), not Mahak, and is also present in the branch/main history.
It changed the backend package manifests, app/index wiring, execution route
and service, ticket and WebSocket services, their tests, and
`docs/verification/2026-10-30-nithin.md`. The global execution API was
introduced separately by Saransh in
`406bacf5728963b23b5668bc9e8f0ca83c7ef456` (`feat(executions): add analytics
and enhanced execution monitoring`, 1 November 2026). That commit changed:

- Backend: `backend/src/models/WorkflowExecution.ts`,
  `backend/src/models/models.test.ts`,
  `backend/src/routes/execution.routes.ts`,
  `backend/src/routes/execution.routes.test.ts`,
  `backend/src/services/execution.service.ts`, and
  `backend/src/services/execution.service.test.ts`.
- Frontend: `frontend/src/api/executionApi.ts`,
  `frontend/src/api/executionRealtime.ts`,
  `frontend/src/executionHelpers.ts`,
  `frontend/src/pages/ExecutionsPage.tsx`,
  `frontend/src/pages/ExecutionsPage.css`,
  and the added `frontend/tests/executionAnalytics.test.ts`,
  `executionDrawer.test.ts`, `executionSearchValidation.test.ts`,
  `executionsPageRender.test.ts`, and `globalExecutions.test.ts`, plus
  updates to `frontend/tests/executionRealtime.test.ts`.

The later Saransh commit `50417e0da85abd3bbb6ade7c8e54d5309a1e1ed3`
hardens idempotency reservation fencing and abandoned-execution recovery; it
is separate from implementing retry policy or a DLQ.

### B. Global execution history and summary APIs

The route router is mounted at `/api/executions` in `backend/src/app.ts`.
The following contract is present on fetched `origin/main` and
`origin/member/mahak`; it is **NOT IMPLEMENTED on the local assigned
`member/mahak` checkout at `eecb7ef`**. The assigned checkout has only the
per-workflow history route described below.

| API | Source contract on fetched main | Authentication and scope | Evidence/status |
|---|---|---|---|
| `GET /api/executions` | No body. Query: `workflowId`, `status`, `from`, `to`, `executionId`, `limit`, `cursor`. `limit` defaults to 20 and must be an integer from 1 to 100. Status must be one of the seven execution statuses. IDs and dates are validated; `from` must not be later than `to`. Fixed stable order is `createdAt DESC, _id DESC`; the compound cursor carries creation time and ID. Response: `{ message, executions, pagination: { limit, hasMore, nextCursor } }`. | `X-API-Key` via tenant auth; service queries use the authenticated tenant ID. No caller-supplied tenant query establishes scope. This is tenant-global history, not a platform-wide admin endpoint. | **VERIFIED by source inspection on main only.** Route/service test sources cover filters, validation, cursor behavior, and tenant scoping; not run in this task. **NOT IMPLEMENTED on local assigned checkout.** |
| `GET /api/executions/summary` | No body. Query: `workflowId`, `from`, `to`. Response: `{ summary, filter }`. `summary` contains `total`, `queued`, `running`, `completed`, `failed`, `compensating`, `compensated`, `compensationFailed`, `unsuccessful`, `successRate`, `failureRate`, and `avgDurationMs`; empty data yields zero counts/rates and `avgDurationMs: null`. Unsuccessful is `failed + compensated + compensationFailed`; rates use terminal count `completed + unsuccessful`. | `X-API-Key` via tenant auth; summary aggregation is tenant-scoped. No role-based platform-admin authorization is present on this route. | **VERIFIED by source inspection on main only.** Route tests include missing-key, default-filter, and tenant-scope cases; service tests cover filters, date validation, aggregation, and tenant match. Not run in this task. **NOT IMPLEMENTED on local assigned checkout.** |

The list and summary endpoints derive data from persisted execution records,
not mock frontend metrics. The aggregation policy treats `compensated` as an
unsuccessful terminal outcome; confirm that product definition before relying
on its user-facing success/failure rates. Summary is not a time-series API and
does not provide P95/P99, worker latency, or quotas.

On local `member/mahak`, the corresponding supported history is
`GET /api/workflows/:workflowId/executions?limit=&cursor=`. It returns
`{ message, executions, pagination: { limit, hasMore, nextCursor } }`; it is
tenant-authenticated and does not provide global, status, date, or
execution-ID filters. `GET /api/executions/:executionId` is the tenant-scoped
detail route.

### C. Frontend/backend contract matrix

| Surface | Frontend expectation / actual use | Backend behavior on local assigned branch | Contract result and impact |
|---|---|---|---|
| Global execution history | Fetched main’s `ExecutionsPage` calls `getGlobalExecutions` with workflow, status, date, execution ID, limit, and cursor; its API client expects `executions` and `pagination`. | Only per-workflow history with `limit` and `cursor`; no global list or filter set. | **Mismatch across refs.** The current local page remains per-workflow and matches that route. Updating the frontend alone would fail against this checkout; review/integrate the main route and service together, do not recreate them. |
| Summary/dashboard | Fetched main’s Dashboard, Analytics, and Executions pages call `getExecutionSummary`; the Dashboard also requests global execution lists. | No summary or analytics API on the assigned checkout. The current local dashboard derives workflow counts from frontend workflow state. | **Mismatch across refs.** Main’s tenant summary does not satisfy admin, quota, worker-latency, or failure-heatmap requirements. Do not treat frontend sample/local counts as persisted execution metrics. |
| Workflow catalog | Current UI searches by name/description and filters status client-side after `GET /api/workflows`; the updated main UI also sorts client-side. | `GET /api/workflows` returns the authenticated tenant’s workflows, ordered by creation time descending; no server search, status filter, sort parameter, or pagination. | **PARTIAL, not a current functional mismatch.** Existing client-side controls operate on the full returned list. Server-side pagination/filtering is an optional scale enhancement until required by product criteria. |
| Execution details | UI requests `GET /api/executions/:executionId` and renders persisted execution/node results, error and timestamps. | Returns `{ message, execution }` for a tenant-owned record; foreign-tenant and missing IDs are indistinguishable `404 EXECUTION_NOT_FOUND`. Stored fields include graph snapshot and node results; execution input is not persisted, ordinary nodes have no per-node start/end times, and `currentNodeId` is not continuously advanced. | **PARTIAL.** Existing detail fields align with current UI; do not promise absent input/progress/timing. If adding sensitive inputs, first approve redaction and retention policy. |
| API error handling | API clients read `error.message` and use HTTP status fallbacks. | Auth failures are `401 { error: { code: "UNAUTHORIZED", message } }`; input/query/ID validation uses `400`; missing or cross-tenant execution detail uses `404`; unhandled errors use generic `500 INTERNAL_SERVER_ERROR`. Invalid JSON is `400 INVALID_JSON`. No distinct `403` authorization path or admin-role guard was found in the workflow/execution routes. | **Generally aligned for current tenant APIs.** There is no admin authorization contract to support platform-wide metrics. Keep not-found behavior tenant-safe; add role-boundary tests if admin endpoints are approved. |

Remote source inspection also found main-only route and service tests for global
history and summary (including summary authentication/default-filter/tenant
scope tests and service filter/date/cursor/aggregation tests). They are
**source-inspected, not executed**. The task’s local backend test run below
cannot verify code absent from the local checkout.

### D. Prioritized implementation gaps

The requirement basis is `docs/requirements.md` (Weeks 3 and 4). Existing
detailed analysis above remains applicable; this table updates its priorities
against the fetched refs. “Before 10 November” is a proposed target, not
implementation authorization.

| Priority / classification | Requirement and verified behavior | Smallest safe next step; security risk | Acceptance criteria and tests | Effort / recommendation |
|---|---|---|---|---|
| P1 — required: retry and DLQ | Week 3 requires configurable retries and a DLQ. Runtime validates retry shape and strips orchestration-only fields, but invokes an action once; no durable attempt history, retry classification/scheduling, DLQ, or worker is implemented on main or the assigned checkout. | Saransh approves retryability, attempt/backoff limits, terminal-failure/DLQ/reprocess contract, and idempotency policy before implementation. Scope runtime/service/model and queue/worker boundary. Tenant-scope every retry and DLQ read/write; retries can duplicate external side effects. | Verify attempts/backoff and exhaustion; retryable/non-retryable classification; cancellation/timeouts; persistence/restart; duplicate dispatch/idempotency; tenant-isolated DLQ retrieval and authorized reprocessing. | **High / High. Before 10 November only after policy and idempotency approval.** |
| P1 — required: isolated transformation | Week 3 requires isolated script execution. A bounded expression validator/evaluator exists, but it is not wired into the production execution handler; no OS/process sandbox or hard resource boundary is established. | Approve the isolation model, allowed operations, input/output limits, resource/time limits, and failure contract before wiring the evaluator. Do not equate validation with sandboxing. | Integration tests prove the approved expression path; invalid input/output rejection; timeout/resource limits; no arbitrary host access or cross-tenant data access; cancellation and failure persistence. | **High / High. Before 10 November only after security/design approval; otherwise do not run untrusted transforms.** |
| P1 — required: admin, quotas, operational metrics | Week 4 requires an administrative dashboard, tenant quotas, failure heatmaps, and worker latency. The global summary on main is tenant-scoped execution analytics only; no quota enforcement/usage source, platform-admin role/route, worker-latency metric, or failure heatmap aggregation was found. | Define metric formulas, windows, quota source/enforcement, empty states, and tenant-admin vs platform-admin roles. Implement only metrics confirmed by requirements. Cross-tenant leakage is the primary risk. | Aggregation/date-boundary and empty-state tests; quota accounting/limit tests; role authorization; cross-tenant denial; ensure tenant credentials cannot request platform totals. | **High / High. Before 10 November for confirmed required metrics, after policy/role approval; defer unrequested visualizations.** |
| P1 — required: scale/deployment evidence | Week 4 requires 1,000+ concurrent execution stress testing and worker scaling. This task ran no load test. Nithin’s 5 November main-branch readiness report distinguishes an L0 in-process harness from distributed/1,000-execution evidence; coordinate with Nithin and do not duplicate his testing. | Use the existing owner’s test plan and only an approved isolated environment. Agree what “concurrent execution” means, plus thresholds and deployment target. Never load-test shared/production MongoDB. | Produce reproducible workload, achieved concurrency, latency/error/queue measurements, and worker restart/scaling evidence; separately validate container/start behavior. | **High / High. Before 10 November only with explicit environment and measurable acceptance criteria; otherwise BLOCKED/NOT VERIFIED.** |
| P1 — required: WebSocket tracing acceptance | Source and automated in-process tests cover ticket issuance, tenant binding, event delivery, and persistence ordering. Manual WebSocket scenarios WS-01 through WS-10 in `docs/websocket-execution-updates.md` remain **NOT RUN**; no live MongoDB/deployed evidence was produced here. | Run only in an approved isolated environment using disposable tenant data and redacted credentials. Preserve all ten actual-status fields; do not infer manual verification from unit tests. | Record sanitized evidence for ticket auth/expiry/reuse, tenant isolation, handshake, event payloads, persist-before-publish, send failure, reconnect, and REST reconciliation. | **Medium / Medium. Verify before 10 November only when the isolated environment is approved; otherwise NOT RUN.** |
| P2 — required for the updated frontend | Main has global history/summary implementations and consumers; the current local assigned checkout does not. | Saransh reviews the existing main commits and authorizes integration as one compatible change (routes/service/model/index/client/pages/tests). Do not duplicate or cherry-pick an API implementation already reachable from main. Re-run tenant isolation and query/aggregation tests after integration. | Frontend and backend agree on list filters, cursor shape, summary fields/metric definitions, auth, empty/error states; tests cover filter combinations, stable pages, date boundaries, aggregation and cross-tenant denial. | **Medium / High. Before 10 November by approved integration/review, not parallel reimplementation.** |
| P2 — frontend build blocker | Current page uses both error helpers but has no imports. Both helper implementations and tests already exist. | Frontend owner adds the two imports only, after approval; do not modify frontend here. | Focused helper tests and `npm run build` pass with no TypeScript diagnostics. | **Low / Low. Before 10 November; assigned to frontend owner.** |
| P3 — optional: server-side workflow catalog search/page | Existing UI filters the full tenant list client-side; no acceptance threshold requiring server-side search or pagination was found. | Defer unless tenant list size/response-size criteria require it; if approved, preserve tenant-first filtering and allow-listed sort fields. | Query validation, stable pagination, empty pages, filters, and cross-tenant tests. | **Medium / Medium. Defer pending product/scale criteria.** |
| P3 — optional metrics enhancements | The summary does not supply historical trend series or P95/P99; main UI reports trend unavailable and withholds percentiles. | Do not fabricate values. Define time buckets, timezone, percentile method, data retention and aggregation budget before adding. | Boundary, empty-bucket, percentile, and tenant-isolation tests. | **Medium / High. Defer pending product and cost approval.** |

### E. Frontend build-helper investigation

The actual `npm run build` from `frontend` failed with these seven
diagnostics in `frontend/src/pages/ExecutionsPage.tsx`:

| Line | Actual diagnostic |
|---:|---|
| 77 | `TS2304: Cannot find name 'sanitizeErrorMessage'.` |
| 457 | `TS2552: Cannot find name 'getErrorText'. Did you mean 'errorText'?` |
| 618 | `TS2304: Cannot find name 'getErrorText'.` |
| 620 | `TS2304: Cannot find name 'getErrorText'.` |
| 637 | `TS2304: Cannot find name 'getErrorText'.` |
| 639 | `TS2304: Cannot find name 'getErrorText'.` |
| 671 | `TS2304: Cannot find name 'sanitizeErrorMessage'.` |

`sanitizeErrorMessage(message: string): string` and
`getErrorText(error: WorkflowExecution['error']): string` are exported from
`frontend/src/executionHelpers.ts` on the local branch and both fetched refs.
The functions also have eight focused cases in
`frontend/tests/themeAndExecutions.test.ts`. The page import is absent at the
local `member/mahak` `HEAD`, but present on fetched `origin/member/mahak` and
`origin/main`. The exact import needed on the local page is:

```ts
import { getErrorText, sanitizeErrorMessage } from '../executionHelpers'
```

No frontend source was changed.

### F. Tests run and evidence limits

| Working directory | Exact command | Result |
|---|---|---|
| `frontend` | `npm run build` | **Failed, exit 2**; exactly the seven TypeScript diagnostics above. |
| `frontend` | `..\backend\node_modules\.bin\tsx.cmd --test tests\themeAndExecutions.test.ts` | **10 passed, 0 failed, 0 skipped** (8 helper cases and 2 theme cases); exit 0. |
| `backend` | `.\node_modules\.bin\tsx.cmd --test src\routes\execution.routes.test.ts src\services\execution.service.test.ts src\services\execution.runtime.test.ts src\middleware\tenantAuth.middleware.test.ts` | **81 passed, 0 failed, 0 skipped**; exit 0. |

The backend tests use injected service dependencies and in-process loopback
HTTP servers; no shared/live MongoDB or production service was used. No setup
error occurred. The frontend build is a compile/bundle check, not an API
runtime check. No full-suite result is claimed from this task. Main-only global
API tests were read but not run. WS-01–WS-10 remain **NOT RUN**; no load,
manual integration, deployment, or live database test was run.

### G. Integration recommendation, blockers, and final state

The lowest-risk code integration, if Saransh approves it, is to fast-forward
the assigned branch to reviewed `origin/main`; do not reimplement or
cherry-pick the already-merged global APIs. The remote branch ancestry shows
no member-only commits to lose. Before any future update, preserve the current
unstaged report edit, all seven existing untracked files, and the stash; this
investigation did not perform that integration.

Decisions/approvals needed from Saransh:

1. Whether and when to fast-forward `member/mahak` after review of main’s
   global execution APIs, idempotency/recovery changes, and frontend overlap.
2. Retry/DLQ semantics, idempotency and replay policy; transformation
   isolation design; administrative roles, quota source, and metric formulas.
3. Whether a safe isolated environment and measurable acceptance criteria
   exist for WebSocket acceptance and distributed concurrency testing; align
   with Nithin before any load test.
4. Confirm the frontend owner will apply the import fix and rerun the build.

**Final delivery boundary:** investigation and documentation only. No
application source change, branch creation/switch, merge, rebase,
cherry-pick, reset, staging, commit, or push was performed. The documentation
update remains unstaged; the seven untracked files and existing stash remain
preserved.

## Supplemental upstream review (5 November 2026)

This supplement records a fresh `git fetch origin` and read-only inspection of
the current refs. It adds detail to the preceding API comparison and separates
code present on upstream from behavior verified by runtime tests. The earlier
report content was preserved.

### Refreshed Git state

| Ref / comparison | Verified value |
|---|---|
| Current branch and local `HEAD` | `member/mahak`, `eecb7ef8273ac87915014df0b1a52f6a69e167b8` |
| Fetched `origin/main` | `bd7cad62857445f80c91c83763a13751e33a155f` |
| Fetched `origin/member/mahak` | `e6cfd17e9fe599803bed928807a5f6321dc04dd0` |
| `origin/main...HEAD` | 36 left-only, 0 right-only: local branch is 36 behind main |
| `origin/main...origin/member/mahak` | 11 left-only, 0 right-only: remote member branch is 11 behind main |
| `HEAD...origin/member/mahak` | 0 left-only, 25 right-only: local checkout is 25 behind its remote member ref |

The starting `git status -sb` was `## member/mahak...origin/member/mahak
[behind 25]`, with only the existing unstaged report edit and these seven
untracked paths:

- `backend/src/validators/workflow-graph.validator.test.ts.bak`
- `backend/src/validators/workflow-graph.validator.test.ts.pre-bom-fix.bak`
- `backend/zaalima-create-isolation-tenant.tmp.ts`
- `backend/zaalima-list-keys.tmp.ts`
- `backend/zaalima-list-tenants.tmp.ts`
- `docs/backend/script-transformation-isolation-assessment.md`
- `docs/backend/script-transformation-isolation-design.md`

The existing stash remains
`stash@{0}: On member/mahak: temp: preserve Mahak websocket verification documentation`.
No branch-specific commits exist outside main. Local `HEAD` remains the merge
base of `origin/main`; this refresh did not move it.

### Execution API source verification

The current upstream route is mounted at `/api/executions` in
`backend/src/app.ts`. `backend/src/routes/execution.routes.ts` implements
tenant-authenticated `GET /` through `service.listGlobalExecutions` and
`GET /summary` through `service.getExecutionSummary`. The per-workflow history
route and `GET /:executionId` remain present. The assigned checkout at local
`HEAD` has only the per-workflow history and detail routes; its execution POST
does not consume an `Idempotency-Key`.

| Surface | Upstream contract and evidence | Assigned checkout |
|---|---|---|
| Global list | `GET /api/executions`; query parameters `workflowId`, `status`, `from`, `to`, `executionId`, `limit`, `cursor`. `listGlobalExecutions` validates IDs/status/dates and limit (default 20, range 1–100), filters on the authenticated tenant, and returns `{ message, executions, pagination: { limit, hasMore, nextCursor } }`. | No global list route or global service method. |
| Cursor paging | `encodeGlobalCursor` / `decodeGlobalCursor` encode `createdAt` plus execution ID. The query uses a stable `createdAt DESC, _id DESC` order and a compound less-than cursor predicate; it reads `limit + 1` records to derive `hasMore`. | Per-workflow history uses its own ID cursor; no global compound cursor. |
| Summary | `GET /api/executions/summary`; accepts `workflowId`, `from`, `to`; returns `{ summary, filter }`. Counts include `total`, each execution status, `unsuccessful`, `successRate`, `failureRate`, and `avgDurationMs`. `unsuccessful` includes failed, compensated, and compensation-failed executions; rates use terminal executions. | No summary route or summary service method. |
| Auth and scope | `tenantAuth.middleware.ts` resolves `x-api-key` and sets trusted `req.tenantContext.tenantId`. Both services receive that tenant ID and include it in execution queries/aggregation. Caller query/body tenant IDs do not set scope. No platform-admin role guard is provided by these endpoints. | Tenant-authenticated workflow history and detail remain; global list/summary are absent. |
| Detail and node persistence | `getExecution` queries by execution ID plus tenant ID. Upstream `WorkflowExecution`/runtime persist node results, compensation state, and per-node start/completion timestamps; the detail response returns the persisted execution. | Detail is tenant-scoped and persists node results, but this ref lacks the later node timing fields and global analytics contract. |
| Frontend | `frontend/src/api/executionApi.ts` exposes `getGlobalExecutions` and `getExecutionSummary`; the executions, dashboard, and analytics pages call them. API tests include unauthenticated and cross-tenant cases; service tests cover tenant filtering, statuses, date/ID filters, malformed cursors, and compound cursor paging. | The current frontend remains paired to per-workflow history; integrating only the newer frontend contract would not work against this backend. |

These are source and test-file findings, not test results from this refresh.
The relevant upstream files are
`backend/src/routes/execution.routes.ts`,
`backend/src/services/execution.service.ts`,
`backend/src/models/WorkflowExecution.ts`,
`backend/src/middleware/tenantAuth.middleware.ts`,
`frontend/src/api/executionApi.ts`, and their route/service/frontend tests.

### Idempotency implementation matrix

Statuses below describe code at fetched `origin/main`; local status refers to
the assigned checkout at `eecb7ef`. “Implemented” is source-level evidence,
not a claim that the current deployment or MongoDB indexes were tested here.

| Finding | `origin/main` status and evidence | Local `member/mahak` status |
|---|---|---|
| Key acceptance and payload binding | **IMPLEMENTED.** The execution POST accepts an optional `Idempotency-Key`; canonical JSON input is SHA-256 hashed. Same-key/different-payload requests return 409; a completed same-payload request returns its cached response. | **NOT IMPLEMENTED.** No key header handling/service/model is present. Requests without a key are not deduplicated on either ref. |
| Persistent reservation and expiry | **IMPLEMENTED (source).** `IdempotencyRecord` stores tenant, workflow, key, payload hash, status, execution ID, reservation token, cached response, and expiry. Unique index is `(tenantId, workflowId, key)`; a TTL index uses `expiresAt`. Default key TTL is 24 hours; application code checks expiry before MongoDB's asynchronous TTL cleanup. | **NOT IMPLEMENTED.** |
| Tenant scope | **IMPLEMENTED (source).** The compound key includes tenant and workflow; reservation, lookup, completion, and deletion use trusted tenant context. Route/service tests cover per-tenant key scope. | **NOT IMPLEMENTED** for idempotency. Existing execution APIs remain tenant-scoped. |
| Concurrent duplicates and fencing | **IMPLEMENTED (source), runtime NOT VERIFIED here.** Atomic insert/replace and the unique index handle duplicate-key races; the route returns 409 for an in-flight key. Reservation UUIDs and ownership checks fence superseded owners. | **NOT IMPLEMENTED.** |
| Failure and retry behavior | **PARTIALLY IMPLEMENTED.** If `startExecution` throws, the owning reservation is cleared so a caller may try again. A terminal failed execution is instead recorded as completed and its failed response is replayed for the same key. Declared task retry policy is not executed; retry scheduling, durable attempt history, and DLQ are **NOT IMPLEMENTED**. | Idempotency failure handling and automatic retry/DLQ are **NOT IMPLEMENTED**. |
| Abandoned reservation recovery | **PARTIALLY IMPLEMENTED.** A repeated request reconciles an in-flight record: preserve active/compensating work; return cached response for terminal work; safely reclaim only a stale reservation whose preallocated execution record does not exist. A per-tenant periodic `IdempotencyRecoveryWorker` is defined and has tests, but repository references show it is not started/wired by application code. The separate execution recovery analyzer is also not wired to a production worker. | **NOT IMPLEMENTED.** |
| Automated evidence | Upstream unit/route test sources cover replay, mismatches, tenant scope, duplicate-key races, expiry, failure release, and recovery. MongoDB integration test sources check durable multi-instance records and indexes, but skip when `MONGODB_URI` is absent/unavailable. None of these upstream tests were run in this refresh. | The prior local test results remain as recorded above; no tests were run for this supplemental review. |

The primary implementation was introduced by Saransh's
`50417e0da85abd3bbb6ade7c8e54d5309a1e1ed3`
(`fix(engine): add reservation fencing token and harden idempotency concurrency`,
2 November 2026). It adds the idempotency service/model and tests, changes the
execution route/runtime/service and `WorkflowExecution`, and adds recovery
analysis/tests. The global list/summary API and frontend integration were
introduced separately by
`406bacf5728963b23b5668bc9e8f0ca83c7ef456`
(`feat(executions): add analytics and enhanced execution monitoring`,
1 November 2026). Both commits are ancestors of fetched `origin/member/mahak`
and `origin/main`, but neither is in the assigned local checkout.

### Incoming changes and merge readiness

From local `HEAD` to `origin/main`, Git reports 61 changed paths (19,784
insertions, 2,346 deletions). The material changes are backend execution
routes/services/runtime, node result persistence, the new idempotency model
and service, recovery code, concurrency benchmark, and their tests; frontend
execution API, monitoring pages, realtime helpers, workflow UI, and tests;
and README/verification/architecture documentation. The seven untracked paths
were individually checked against `origin/main`; none collides. The committed
verification report path is unchanged between local `HEAD` and `origin/main`,
so the existing unstaged edit has no upstream file-level overlap. No package
manifest/lockfile change was found. Schema/index changes are Mongoose model
definitions, with no migration script identified; target MongoDB index
creation still needs verification before deployment.

The fetched `origin/main` has 10 file changes beyond
`origin/member/mahak`: three verification/retry-DLQ documents and seven CSS
files. The latest Nithin verification notes say retry execution and DLQ remain
not implemented and that recovery analysis exists but is unwired. These are
documentation/UI changes, not additional execution API code.

**Recommendation: ready for a reviewed fast-forward only after Saransh
approves; do not integrate as part of this investigation.** Local `HEAD` is an
ancestor of main and has no unique commits to preserve. The API changes are
additive and retain per-workflow history/detail, but the newer frontend and
backend must be integrated together. Before approval, decide whether to wire
the periodic per-tenant recovery worker and confirm the 24-hour key-retention
and terminal-failure replay policy. After approval, run backend build/tests,
MongoDB integration with an approved disposable database (including unique
and TTL index creation), frontend tests/build, tenant-isolation and concurrent
duplicate checks, and only then any separately approved load/WebSocket
acceptance tests. No such checks or integration were performed here.

### Supplemental delivery boundary

The only edit in this refresh is this appended report section. No application
source was changed and no branch integration or delivery operation was
performed. `HEAD` stayed `eecb7ef8273ac87915014df0b1a52f6a69e167b8`;
the report remains unstaged, all seven untracked files and the existing stash
remain preserved.

## Post-fast-forward execution and recovery verification (5 November 2026)

This section supersedes the earlier “do not integrate” recommendation and
pre-integration final-state statements above. The integration below was
explicitly approved in the supplied task and performed only after its safety
checks passed. Earlier audit evidence and the original unstaged report text
remain intact.

### A. Pre-integration safety, backup, and fast-forward

Phase A verified branch `member/mahak`, starting `HEAD`
`eecb7ef8273ac87915014df0b1a52f6a69e167b8`, the expected unstaged report
edit, no staged changes, the seven preserved untracked files, and the existing
stash. Before fetching, the complete report and its unstaged Git diff were
backed up outside the repository:

- Report copy: `C:\Users\Mahak\AppData\Local\Temp\workflow-orchestration-engine-member-mahak-20261105-230210462\WORKFLOW_VERIFICATION_REPORT.md`
- Unstaged patch: `C:\Users\Mahak\AppData\Local\Temp\workflow-orchestration-engine-member-mahak-20261105-230210462\WORKFLOW_VERIFICATION_REPORT.unstaged.patch`
- Pre-integration report SHA-256: `D7540E62531B771001C56104A7C529393E74D1E5F3F2A04F302B0953A248E7EF`

Both external files existed and were verified; the report copy hash matched
the working report. After fetching, preflight found no incoming change to
`backend/WORKFLOW_VERIFICATION_REPORT.md`, no collision with any of the seven
untracked paths, and no unexpected modified or staged files. Only then was
the approved command run:

```text
git merge --ff-only origin/main
```

It succeeded as a fast-forward from `eecb7ef` to
`bd7cad62857445f80c91c83763a13751e33a155f`. The report was byte-for-byte
identical to its external backup immediately after integration, confirming
the pre-existing unstaged content was preserved. This section was appended
after that comparison. No source files were changed. No branch was created
or switched, and no stage, commit, push, rebase, cherry-pick, reset, or other
integration operation occurred.

### B. Integrated API and idempotency verification

The fetched/integrated `HEAD` is `bd7cad62857445f80c91c83763a13751e33a155f`,
matching fetched `origin/main`. The API, cursor, authentication, and
idempotency source findings in the preceding supplement are now present in
the working branch. Focused route/service/frontend tests run after the
fast-forward are recorded below; they are in-process tests, not live service
or database verification.

The execution POST handles `Idempotency-Key` in
`backend/src/routes/execution.routes.ts`. It hashes the canonical JSON input,
reserves by authenticated tenant + workflow + key, replays a cached response
for a matching completed request, and returns 409 for a changed payload or
an active in-flight request. If `startExecution` throws, the owning
reservation is cleared. A returned terminal failed execution is recorded as
completed, so a repeat with the same key replays that failed result rather
than dispatching again. This is intentionally distinct from an automatic
retry policy.

### C. Retention and MongoDB TTL evidence

The idempotency service default is 24 hours (`ttlMs = 24 * 60 * 60 * 1000`);
completion refreshes `expiresAt` relative to the completion time. The model
declares a TTL index on `expiresAt` with `expireAfterSeconds: 0`, and the
service also checks `expiresAt` in application logic before treating an
existing key as live.

**PENDING COORDINATOR CONFIRMATION — NOT AN OFFICIALLY APPROVED POLICY.**
The 24-hour default is an implementation default only, not an approved
retention decision. MongoDB TTL deletion is asynchronous/eventual, not a
guarantee that a record disappears exactly at its expiry timestamp. The
conditional integration test calls `syncIndexes()` and asserts the declared
unique and TTL indexes, but it does not demonstrate actual TTL deletion at an
exact time. No `MONGODB_URI` was configured in the process environment and no
approved isolated MongoDB URI/environment was available. Therefore:

- TTL index creation in a running database: **NOT VERIFIED**.
- Actual TTL expiration/deletion: **NOT VERIFIED / NOT RUN**.
- No shared or production database was contacted.

### D. Reservation recovery worker assessment

The `IdempotencyRecoveryWorker` is implemented as a class in
`backend/src/services/executionIdempotency.ts`, with memory-backed/unit tests.
It scans stale in-flight records for one supplied tenant and calls
`reconcileInFlightReservation`. The reconciliation logic preserves queued,
running, and compensating execution records; it reconstructs cached responses
for terminal records; and it can reclaim a stale reservation only when its
preallocated execution record is missing. The reclaim update uses tenant,
workflow, key, status, execution ID, prior reservation token, and prior
`updatedAt` as a compare-and-set filter before replacing the token.

| Requirement | Finding |
|---|---|
| Start only after DB readiness | **NOT IMPLEMENTED.** The server awaits `connectDatabase()` before listening, but the recovery worker is not constructed or started by `index.ts`. |
| Create and verify indexes before processing | **NOT IMPLEMENTED / NOT VERIFIED.** The model declares indexes; startup awaits `mongoose.connect()` only. No startup `syncIndexes()`/verification gate was found. |
| Expiry and recovery eligibility | **PARTIAL.** Request-time service checks `expiresAt`; recovery scans by record age and execution state. This is not proof of MongoDB TTL expiry. |
| Reservation fencing | **PARTIAL / source verified.** A stale reclaim is fenced by a conditional update and new UUID token; the execution route checks reservation ownership before starting execution. No cross-process runtime test was run here. |
| Tenant scope | **IMPLEMENTED in the service.** Worker construction requires one tenant ID and database scans filter by it. No startup tenant enumeration or per-tenant worker lifecycle exists. |
| Multiple worker instances | **PARTIAL / NOT VERIFIED.** The local `isReconciling` flag prevents overlapping runs only inside one process. Compare-and-set protects the stale missing-execution reclaim, but there is no distributed worker lease/election; multi-instance recovery was not tested. |
| Processing errors | **NOT IMPLEMENTED safely.** The interval callback ends in `.catch(() => {})`, silently discarding rejected `runOnce()` errors. |
| Shutdown | **PARTIAL.** The worker clears its timer and waits for its own in-flight reconciliation. `index.ts` graceful shutdown stops the change-stream watcher, WebSocket server, and HTTP server, but has no recovery-worker stop hook. |
| Startup failure cleanup | **NOT VERIFIED / NOT IMPLEMENTED for this worker.** Existing startup cleanup covers the change-stream watcher and server only. |
| Lifecycle test coverage | **PARTIAL.** Unit tests cover worker periodic start/stop and service recovery cases. `index.test.ts` covers current database/listen/watcher ordering and shutdown, not recovery-worker lifecycle, DB-not-ready, startup index verification, or error logging. No MongoDB-backed recovery test ran here. |

**Worker wiring decision: BLOCKED; no implementation made.** This is not a
small startup-only integration with sufficiently defined safety semantics.
The worker requires a tenant ID, but startup has no tenant enumeration/
provisioning contract; index readiness has no explicit gate; scheduled errors
are silently swallowed; and multi-instance coordination is not established.
The task explicitly says to stop rather than guess when readiness, index,
fencing, or shutdown semantics are unclear. Before wiring, decide the
tenant-discovery/lifecycle model, verify indexes before starting, replace
silent failure handling with observable logging/retry policy, and establish
multi-instance ownership and shutdown guarantees.

### E. Focused validation actually run

No dependencies were installed or updated.

| Working directory | Exact command | Result |
|---|---|---|
| `backend/` | `.\node_modules\.bin\tsx.cmd --test src\services\executionIdempotency.test.ts src\services\executionRecovery.test.ts src\routes\execution.routes.test.ts src\index.test.ts` | **72 passed, 0 failed, 0 skipped**. Covers memory-backed idempotency/recovery, routes, and existing server lifecycle. It does not exercise the unrun Mongo integration file or new recovery-worker startup wiring. |
| `backend/` | `.\node_modules\.bin\tsx.cmd --test src\services\execution.service.test.ts` | **55 passed, 0 failed, 0 skipped**. |
| Repository root | `.\backend\node_modules\.bin\tsx.cmd --test frontend\tests\globalExecutions.test.ts` | **13 passed, 0 failed, 0 skipped**. |

The Mongoose idempotency integration tests, TTL/index checks against MongoDB,
live persistence/expiry, distributed recovery, and retry/DLQ tests against a
live worker were **NOT RUN**. The first three commands validate only the
executed tests and their injected/in-memory paths. No full build or full test
suite is claimed for this post-fast-forward task.

### F. Retry/DLQ plan and Nithin coordination draft

Retry execution and a durable DLQ remain **NOT IMPLEMENTED**. The integrated
tests explicitly verify that a declared node retry policy does not currently
cause an action retry. No public API or state-machine change is authorized by
this report.

Minimal plan for review before implementation:

1. Define typed transient/permanent failure categories. Treat unknown or
   side-effect-ambiguous outcomes as non-retryable until classified.
2. Approve bounded attempts (including whether the count includes the first
   attempt), exponential backoff base/cap/jitter, task timeout, and
   cancellation behavior.
3. Persist attempt number, failure classification, next-attempt time, and
   enough execution/node checkpoint state to survive restart without
   replaying already-completed side effects.
4. Define terminal transition and persist an exhausted execution to a
   tenant-scoped durable DLQ record, with sanitized error and attempt
   history.
5. Define explicit, authorized redrive semantics: which roles may redrive,
   whether redrive resumes a safe checkpoint or creates a new execution, and
   how redrive itself is idempotent.
6. Preserve tenant filters for retry scans, DLQ reads/writes, and redrive.
   Never automatically repeat an action whose side-effect outcome is
   uncertain.
7. Test failure classification, attempt bounds/backoff, restart persistence,
   terminal exhaustion, DLQ tenant isolation, authorization, idempotent
   redrive, cancellation, and ambiguous side effects. Add approved isolated
   MongoDB tests for persistence and concurrency before claiming distributed
   behavior.

**Draft coordination message for Nithin — not sent:**

> I fast-forwarded `member/mahak` to `bd7cad6` after the approved preflight.
> Source and focused in-process tests confirm global execution list/summary
> and tenant/workflow-scoped idempotency with payload hashing, cached replay,
> TTL/unique index declarations, and fencing. The 24-hour key lifetime is
> still pending coordinator confirmation; MongoDB index creation/TTL expiry
> were not tested. The reservation recovery class exists, but it is not wired
> into startup; it is per-tenant, has no startup index-readiness gate, silently
> swallows scheduled errors, and has no distributed worker lease/lifecycle
> integration. Retry execution, durable attempt state, DLQ, and redrive remain
> unimplemented. Could we align the minimal retry/DLQ plan with your
> concurrency assessment: transient/permanent classification, attempt/backoff
> policy, persisted next-attempt and checkpoint state, terminal exhaustion,
> DLQ access/redrive authorization and idempotency, and tests for tenant
> isolation/restart/concurrent dispatch? I have not contacted anyone or run a
> load test.

No claim of communication with Nithin is made.

### G. Post-fast-forward delivery state

The only working-tree edit after the fast-forward is this appended report
section. The report's pre-fast-forward backup and patch remain outside the
repository. The original report bytes were verified equal to the backup
immediately after the fast-forward and before this append. The original
unstaged report changes, all seven untracked files, and the existing stash
remain preserved. No application source changes were made.

## 6 November 2026 — Upstream API, Idempotency and Recovery Verification

### Scope, starting state, and evidence labels

This audit was performed on `member/mahak` at
`5a12e3f84c3f10f592b7899623adc5a3af820d8b`. The starting working tree had
only the seven protected untracked files listed in the earlier report;
there were no tracked or staged changes. `stash@{0}` remained
`temp: preserve Mahak websocket verification documentation`. No upstream
fetch or integration operation was performed during this audit.

Before editing this report, a byte-for-byte backup was created outside the
repository at
`C:\Users\Mahak\AppData\Local\Temp\workflow-orchestration-engine-WORKFLOW_VERIFICATION_REPORT-before-20261106-20261106-233522.md`.
Its SHA-256 matched the source report:
`0D4D2F0273BCD8A0AF0EA99A1F98DA82AB2D4A1B4010980B61D00A4861828997`.

Evidence labels in this section mean:

- **VERIFIED** — directly supported by inspected source or an executed test.
- **PARTIAL** — some behavior is supported, but relevant verification is incomplete.
- **MISSING** — required implementation is absent from inspected source.
- **UNKNOWN** — available evidence is insufficient to decide.
- **NOT TESTED** — behavior was not executed or validated.

Automated tests used in-process handlers, injected dependencies, memory
stores, or schema metadata. They are not live database, deployment, or
multi-instance evidence.

### A. Global execution history — `GET /api/executions`

| Requirement | Finding | Source and test evidence |
|---|---|---|
| Authentication | **VERIFIED** | `backend/src/app.ts` mounts the execution router at `/api/executions`; `backend/src/routes/execution.routes.ts` applies `tenantAuthMiddleware` to `GET /`. `backend/src/middleware/tenantAuth.middleware.ts` rejects missing or unresolved `X-API-Key` with HTTP 401 and obtains tenant context through `backend/src/services/tenantResolver.ts`. |
| Tenant identity manipulation | **VERIFIED** | The route passes only `req.tenantContext.tenantId` and selected query parameters to the service. A query `tenantId` is not used as identity and is not forwarded. Identity is resolved from the API key hash and active key/tenant records. |
| Database tenant scope | **VERIFIED** | `backend/src/services/execution.service.ts` always includes the trusted `tenantId` in global history's MongoDB filter before calling `WorkflowExecutionModel.find(filter)`. Optional filters are combined with that tenant predicate. The service test captures this filter. |
| Cross-tenant isolation | **PARTIAL** | Source and service test support tenant scoping. Existing route isolation coverage is for per-workflow history, not a direct second-tenant request to `GET /api/executions`; no live MongoDB or cross-tenant global-route test was run. |
| Missing/invalid tenant context | **VERIFIED** | Missing/invalid API key is rejected by middleware with `{ error: { code: "UNAUTHORIZED", message: "A valid API key is required" } }` and HTTP 401. The route also returns the same response if authenticated context is unexpectedly absent. Resolver/database errors flow to the generic HTTP 500 handler. |
| Response contract | **VERIFIED** | Route returns `{ message, executions, pagination }`, where `pagination` is `{ limit, hasMore, nextCursor }`. `executions` are raw lean execution documents; the model defines `_id`, `tenantId`, `workflowId`, `workflowVersion`, `status`, `graphSnapshot`, `currentNodeId`, `nodeResults`, optional compensation metadata, `error`, `startedAt`, `completedAt`, and timestamp fields. There is no computed `duration`, `workflowName`, or total-result count in this response. |
| Pagination | **VERIFIED** | Default `limit` is 20; accepted range is integer 1–100 inclusive. Invalid, fractional, zero, or over-100 values yield `ExecutionServiceError` HTTP 400 / `VALIDATION_ERROR`. Query fetches `limit + 1`; `hasMore` is based on the extra record. No total count is returned. |
| Cursor and ordering | **VERIFIED** | The opaque base64url cursor encodes `{ createdAt, id }`. The DB query sorts by `{ createdAt: -1, _id: -1 }`; next-page filtering uses earlier `createdAt`, then lower `_id` for ties. This is deterministic for the sort keys; behavior under concurrent inserts/updates was **NOT TESTED**. Malformed cursor JSON, timestamp, or 24-character ID is rejected with HTTP 400. |
| Filters | **VERIFIED** | Supported service filters are `workflowId`, one of the seven defined `status` values, inclusive `from`/`to` bounds on `createdAt`, exact `executionId`, `limit`, and `cursor`. Invalid IDs, statuses, dates, reversed date ranges, and limits are rejected. The query executes in MongoDB; filtering is not applied after retrieval. |
| Search, sort, and unknown parameters | **PARTIAL** | The UI's execution-ID search maps to the exact `executionId` filter; no free-text search exists. No sort field or direction is supported by the route/service/client, and the DB order is fixed. Unrecognized parameters such as `sort` or `tenantId` are not forwarded or explicitly rejected; they are ignored. |
| Empty result | **VERIFIED** | Service returns `executions: []` with `{ limit, hasMore: false, nextCursor: null }`. This is covered by an injected-dependency service test. |
| Route-level coverage | **PARTIAL** | `backend/src/routes/execution.routes.test.ts` exercises execution route authentication and per-workflow history, but does not directly exercise the global history route. Global filters and pagination are tested at service level in `backend/src/services/execution.service.test.ts`. |

Validation errors are serialized as
`{ error: { code: "VALIDATION_ERROR", message } }`. Unexpected errors are
logged server-side and returned as generic
`{ error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred." } }`.

### B. Global execution summary — `GET /api/executions/summary`

| Requirement | Finding | Source and test evidence |
|---|---|---|
| Authentication and tenant scope | **VERIFIED** | Uses the same tenant-auth middleware. `getExecutionSummary` begins its MongoDB aggregation with `$match: { tenantId }`; optional workflow/date predicates are added to that match. Route and service tests check authenticated context and the tenant-scoped aggregation pipeline. |
| Response shape and empty results | **VERIFIED** | Returns `{ summary, filter }`. `summary` contains `total`, `queued`, `running`, `completed`, `failed`, `compensating`, `compensated`, `compensationFailed`, `unsuccessful`, `successRate`, `failureRate`, and `avgDurationMs`; `filter` contains nullable `workflowId`, `from`, and `to`. Empty aggregation returns zero counts/rates and `avgDurationMs: null`. |
| Metric calculation | **VERIFIED** | MongoDB `$group` counts all seven statuses and sums valid nonnegative `completedAt - startedAt` durations. `unsuccessful` is `failed + compensated + compensation_failed`; rates use terminal count (`completed + unsuccessful`) and are percentages rounded to two decimal places. Average duration is rounded milliseconds or null if there are no eligible durations. |
| Time window and filters | **VERIFIED** | Supports optional workflow ID and inclusive `from`/`to` bounds over `createdAt`, validated before aggregation. Invalid IDs/dates and `from > to` return HTTP 400. There is no status/search filter on the summary endpoint. |
| Errors and tests | **VERIFIED** | Missing API key is tested as 401; summary filters, invalid values, empty aggregation, counts, rates, duration, and tenant `$match` are covered by route/service tests. Unexpected errors use the generic HTTP 500 handler described above. No live aggregation was run. |

### C. Idempotency and reservation fencing

| Requirement | Finding | Source and test evidence |
|---|---|---|
| Scope | **VERIFIED** | `IdempotencyRecord` has a unique compound index declared on `(tenantId, workflowId, key)`. Service reads, updates, and deletes use the same triplet. The route uses authenticated tenant context and workflow ID. Unit tests cover distinct tenants and workflows. |
| Payload hash | **VERIFIED** | `computePayloadHash` serializes JSON recursively with sorted object keys and hashes with SHA-256. The route hashes `input ?? {}`; workflow and tenant are separate scope fields. Array order is preserved. Unit tests cover reordered object keys and different payloads. |
| Same-key behavior | **VERIFIED** | Matching completed requests replay the stored response. Different payload returns HTTP 409 `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`. A matching active request returns HTTP 409 `IDEMPOTENCY_KEY_IN_FLIGHT`. A missing execution within the creation grace period remains in flight; after the grace period it can be reclaimed only after the execution lookup confirms no document and the conditional claim succeeds. |
| Reservation race and fencing | **PARTIAL** | Creation uses the compound unique index to arbitrate duplicate inserts; expired records are atomically replaced and stale missing-execution reconciliation rotates a UUID `reservationToken` using a conditional update. The route validates token ownership before starting execution and supplies the token to completion/release operations. Memory unit tests cover duplicate-request simulation and stale-token cleanup/completion attempts. Real MongoDB concurrency was **NOT TESTED**. |
| Terminal failures and retry | **VERIFIED** | A terminal failed execution is recorded as a completed idempotency result and the same key/payload replays it; this is cached failure replay, not an automatic retry. A `startExecution` exception attempts token-scoped reservation release so a later client request can try again. No explicit retry/redrive API or background retry policy was found (**MISSING**). |
| Startup/recording failure edge | **PARTIAL** | If execution startup throws, the route releases the matching token reservation. If completion recording fails after execution creation, a later request can reconcile using the persisted execution; this recovery path is source-level behavior, not a live database test. The return value of `recordCompleted`'s conditional update is not checked by the route/service caller. |
| Failed-result replay test evidence | **PARTIAL** | Route and service tests cover successful response replay, payload conflict, in-flight duplicate requests, and startup-error release. Reconciliation tests cover terminal completion; no dedicated focused test asserting replay of a terminal failed response was identified in the selected test sources. |

### D. Retention and MongoDB indexes

| Requirement | Finding | Source and test evidence |
|---|---|---|
| Retention duration | **VERIFIED** | `IdempotencyService` defaults to `24 * 60 * 60 * 1000` milliseconds. Reservation sets `expiresAt` from reservation time; completion refreshes it from completion time. Constructor and method options can override it in code; no environment-based setting was found. The 24-hour duration remains **PROPOSED, NOT APPROVED** as a policy. |
| Expiration behavior in application code | **VERIFIED** | `reserveKey`/`checkIdempotency` compare `expiresAt` to current time; expired reservation replacement uses an atomic expiry predicate. |
| Index declarations | **VERIFIED** | `backend/src/models/idempotencyRecord.model.ts` declares the unique tenant/workflow/key index and TTL index `{ expiresAt: 1 }` with `expireAfterSeconds: 0`. Schema tests inspect these declarations only. |
| Index initialization and readiness | **PARTIAL** | `backend/src/config/database.ts` awaits `mongoose.connect`; `backend/src/index.ts` awaits that connection before listening. No explicit `IdempotencyRecordModel.init()`, `syncIndexes()`, index verification, or awaited index-readiness gate is present in startup. Mongoose/runtime index creation was **NOT TESTED**. |
| MongoDB TTL creation/expiry | **NOT TESTED** | The conditional Mongo integration test calls `syncIndexes()` and queries MongoDB indexes, but it was deliberately excluded from execution. No approved isolated MongoDB endpoint was used. TTL index existence in a live DB and eventual document deletion remain unverified; declaration alone is not evidence that TTL is active. |

### E. Reservation recovery worker

| Requirement | Finding | Source and test evidence |
|---|---|---|
| Worker implementation and startup | **PARTIAL** | `IdempotencyRecoveryWorker` exists in `backend/src/services/executionIdempotency.ts`, but `backend/src/index.ts` does not instantiate/start it. App startup therefore does not run reservation recovery. |
| DB/index readiness | **MISSING** | If manually started, the worker has no readiness or index gate. Server startup waits for DB connection, but not declared index initialization. |
| Tenant discovery | **MISSING** | Worker constructor requires one tenant ID; no tenant enumeration or worker provisioning is wired into startup. The database scan is tenant-scoped, but no cross-tenant orchestration exists. |
| Eligibility and stale claim | **PARTIAL** | `findInFlightRecords` selects one tenant's in-flight records by `createdAt <= cutoff`, ascending, with a batch limit. Missing execution documents inside grace are preserved; after grace, a compare-and-set claim checks tenant/workflow/key/status/execution ID plus prior token and `updatedAt`, then rotates the token. Existing queued/running/compensating executions are preserved; terminal executions are reconciled into a cached response. |
| Reservation fencing during terminal reconciliation | **PARTIAL** | Missing-execution retry claim uses token/updatedAt fencing. The terminal reconciliation update filters by tenant/workflow/key and `status: "in_flight"` but does not include the observed reservation token or `updatedAt`; its update result is not checked. A concurrent token replacement could therefore race with a stale terminal reconciliation. This is a source-level race risk; it was not reproduced in a runtime test. |
| Concurrent recovery / multiple instances | **PARTIAL** | `isReconciling` prevents overlap only within one worker instance. No distributed lease/election is present. Conditional stale-claim updates offer some cross-instance protection, but terminal reconciliation is not equivalently fenced. Multi-instance behavior was **NOT TESTED**. |
| Crash recovery | **PARTIAL** | The scan is batched and sequential; successful item updates persist individually. A later sweep or request-path reconciliation can revisit remaining in-flight records. No crash-injection or restart test was run. |
| Scheduled errors | **MISSING** | The timer callback invokes `runOnce().catch(() => {})`, silently discarding scheduled failures. Direct `runOnce()` propagates errors; interval-driven runs do not report them. |
| Shutdown | **PARTIAL** | `stop()` clears the interval and waits for local reconciliation to finish. `backend/src/index.ts` graceful shutdown stops the change-stream watcher, WebSocket server, and HTTP server, but does not stop or await this recovery worker because it is not wired. |
| Related execution recovery helper | **VERIFIED** | `backend/src/services/executionRecovery.ts` contains pure execution-state analysis and a CAS terminal update helper; it is not a scheduled reservation worker and is not integrated into startup. Unit tests cover evaluation and CAS behavior. |

Worker lifecycle unit tests use memory-backed dependencies. The MongoDB
integration test that would use real records/indexes was not run. No worker
was started or wired during this audit.

### F. Frontend compatibility

| Requirement | Finding | Source and test evidence |
|---|---|---|
| Endpoints/authentication | **VERIFIED** | `frontend/src/api/executionApi.ts` calls `/api/executions`, `/api/executions/summary`, `/api/executions/:executionId`, and the per-workflow executions endpoint as needed; it sends `X-API-Key` and rejects an empty key. Tenant context is selected by the backend from that key; no client tenant ID is sent. |
| Pagination and filters | **VERIFIED** | `ExecutionsPage.tsx` requests page size 20 and passes `nextCursor`. It uses workflow history only when a workflow is selected without other filters; otherwise it uses global history with workflow/status/from/to/exact execution ID filters. Dates are converted to ISO strings. |
| Sorting | **MISSING** | The client/page provide no sort field or direction; backend order remains fixed newest-first. |
| Response compatibility | **VERIFIED** | The history client expects `executions` and `pagination`, which matches the route response. Its execution type permits both `id` and `_id`; backend raw records have `_id`, `workflowId`, and `status`. The page computes duration from `startedAt`/`completedAt`; it resolves workflow names separately from the workflow list and falls back to the workflow ID. Summary fields and `compensationFailed` naming match the backend. |
| Errors and details navigation | **VERIFIED** | Client methods translate API error messages or HTTP status into thrown errors; page handlers surface sanitized messages. Detail navigation accepts `id` or `_id` and calls the authenticated detail endpoint. |
| UI test evidence | **VERIFIED** | Focused global API client, analytics client/helpers, and executions-page rendering tests passed (details below). These are mocked/in-process tests, not browser-to-live-backend verification. |

### G. Exact tests run and limitations

Test scripts were inspected in `backend/package.json` and
`frontend/package.json`. Backend uses Node's test runner through `tsx`; the
frontend has no test script, and its tests were invoked with the already
installed backend `tsx` executable. The selected backend test files use
injected service/resolver dependencies, in-memory idempotency stores, fake
startup dependencies, and Mongoose schema metadata. The selected frontend
tests use mocked API responses/component rendering. The MongoDB integration
test file, which reads `MONGODB_URI` and may connect to that database, was
excluded. No dependency was installed or changed.

| Working directory | Exact command | Environment and actual result |
|---|---|---|
| `backend/` | `.\node_modules\.bin\tsx.cmd --test src\routes\execution.routes.test.ts src\services\execution.service.test.ts src\services\executionIdempotency.test.ts src\services\executionRecovery.test.ts src\index.test.ts src\models\models.test.ts` | In-process routes/fakes, injected or memory dependencies; no shared/production DB. **VERIFIED**: 162 passed, 0 failed, 0 skipped; exit code 0. |
| Repository root | `.\backend\node_modules\.bin\tsx.cmd --test frontend\tests\globalExecutions.test.ts frontend\tests\executionAnalytics.test.ts frontend\tests\executionsPageRender.test.ts` | Mocked API and component tests; no live API/database. **VERIFIED**: 32 passed, 0 failed, 0 skipped; exit code 0. |

Not run: `backend/src/services/executionIdempotency.integration.test.ts`,
full test suites, builds, live MongoDB/index/TTL checks, live API calls,
multi-instance recovery, deployment, or load tests (**NOT TESTED**).

### H. Files inspected, blockers, and next actions

Exact implementation/test/configuration files inspected:

- Backend: `backend/src/app.ts`, `backend/src/routes/execution.routes.ts`,
  `backend/src/routes/execution.routes.test.ts`,
  `backend/src/middleware/tenantAuth.middleware.ts`,
  `backend/src/middleware/errorHandler.middleware.ts`,
  `backend/src/services/tenantResolver.ts`,
  `backend/src/services/execution.service.ts`,
  `backend/src/services/execution.service.test.ts`,
  `backend/src/models/WorkflowExecution.ts`,
  `backend/src/models/idempotencyRecord.model.ts`,
  `backend/src/models/models.test.ts`,
  `backend/src/services/executionIdempotency.ts`,
  `backend/src/services/executionIdempotency.test.ts`,
  `backend/src/services/executionIdempotency.integration.test.ts` (inspection
  only),
  `backend/src/services/executionRecovery.ts`,
  `backend/src/services/executionRecovery.test.ts`,
  `backend/src/config/database.ts`, `backend/src/index.ts`,
  `backend/src/index.test.ts`, and `backend/package.json`.
- Frontend: `frontend/src/api/executionApi.ts`,
  `frontend/src/pages/ExecutionsPage.tsx`,
  `frontend/tests/globalExecutions.test.ts`,
  `frontend/tests/executionAnalytics.test.ts`,
  `frontend/tests/executionsPageRender.test.ts`, and
  `frontend/package.json`.

Only this verification report was modified. No application source or frontend
source was changed.

Blockers and smallest next actions:

1. Treat the 24-hour retention value as an implementation default only until
   an authorized owner explicitly approves the retention policy.
2. Before claiming durable index readiness, establish an approved isolated
   MongoDB test environment and verify actual unique/TTL index creation and
   eventual TTL deletion; define an explicit startup index-readiness gate if
   required.
3. Keep recovery-worker startup wiring out of scope until tenant discovery,
   index readiness, observable error/retry handling, graceful shutdown, and
   multi-instance coordination are designed and approved.
4. Review and test the terminal reconciliation fencing gap: its conditional
   update is not tied to the reservation token/version observed during lookup.
5. Add a direct global-history route test for tenant isolation and a focused
   terminal-failed-result replay test before treating those exact behaviors
   as route-level test coverage.
6. Retry/redrive remains **MISSING**; cached terminal failure replay must not
   be represented as automatic retry.

### I. Git safety and final audit state

Final verification left the branch at
`5a12e3f84c3f10f592b7899623adc5a3af820d8b` on `member/mahak`. The seven
protected untracked files remained present and untracked; the existing
`stash@{0}` remained unchanged. The only tracked modification is this
appended report section; no staged changes, source edits, branch operations,
commit, push, or PR creation occurred.

## 6 November 2026 — Reservation Fencing and Recovery Implementation Plan

### 1. Scope and investigation status

This is an investigation and proposal only. No application source or test
source was changed, and no test or live database operation was run in this
phase. The starting branch and SHA were `member/mahak` and
`5a12e3f84c3f10f592b7899623adc5a3af820d8b`. The existing Phase 2 audit
report modification, seven protected untracked files, and
`stash@{0}: temp: preserve Mahak websocket verification documentation` were
preserved.

Before appending this plan, the complete report was backed up outside the
repository to
`C:\Users\Mahak\AppData\Local\Temp\workflow-orchestration-engine-report-before-fencing-plan-20261106-234504.md`.
The backup SHA-256 and report SHA-256 matched:
`7C204BA9E24AC5FDF6B29F2CF2B64EEF49AE45E60A74BACC8A36A7377D39EF9C`.

Evidence labels:

- **VERIFIED** — directly supported by inspected source or an existing test.
- **PARTIAL** — evidence exists but does not establish the full behavior.
- **MISSING** — required implementation or coverage is absent.
- **UNKNOWN** — evidence is insufficient to decide.
- **NOT TESTED** — behavior was not executed in this phase.

The Phase 2 audit section above remains intact. The pre-append backup for
that audit and this phase's backup are separate files outside the repository.

### 2. Reservation lifecycle and race hypothesis

Relevant current source:

- `backend/src/models/idempotencyRecord.model.ts` — `IdempotencyRecord`
  fields, unique `(tenantId, workflowId, key)` index, and TTL declaration.
- `backend/src/services/executionIdempotency.ts` —
  `mongoIdempotencyDependencies`, `reserveKey`,
  `reconcileInFlightReservation`, `validateOwnership`, `recordCompleted`,
  `clearKey`, and `IdempotencyRecoveryWorker`.
- `backend/src/routes/execution.routes.ts` — execution POST reservation,
  ownership check, execution dispatch, completion, and error release.
- `backend/src/services/executionIdempotency.test.ts` — memory-backed
  lifecycle, terminal reconciliation, recovery, and token-fencing tests.
- `backend/src/services/executionIdempotency.integration.test.ts` — optional
  live-MongoDB tests; inspected only and not run.
- `backend/src/models/models.test.ts` — schema/index declaration tests.

The schema has an optional `reservationToken` (default `null`), `payloadHash`,
`executionId`, `status`, `expiresAt`, and Mongoose timestamps. A new
reservation gets a UUID token. Expired reservation replacement uses an
atomic update requiring the key scope and `expiresAt <= now`, then installs
the new payload hash, execution ID, in-flight status, expiry, and token.
Stale missing-execution reconciliation similarly uses status, execution ID,
observed token when truthy, and observed `updatedAt` when present; it checks
the returned update result before reporting `RETRY_SAFE`.

Terminal reconciliation differs: after reading an in-flight reservation and
finding its preallocated execution is terminal, it performs an update
filtered by `{ tenantId, workflowId, key, status: "in_flight" }`, and sets
`status: "completed"`, `responseBody`, `executionId`, and `updatedAt`. It
does not include the observed token, payload hash, execution ID, or timestamp
in that filter, and it does not check whether the update matched before
returning `COMPLETED_RECONCILED`.

#### Concrete interleaving (source-supported hypothesis; not reproduced)

1. **A** reads reservation A: scope `(tenant, workflow, key)`, payload hash
   H-A, execution ID E-A, token T-A, status `in_flight`. A looks up E-A and
   observes a terminal execution, then pauses before persisting the result.
2. The record expires. **B** submits a request for the same key. `reserveKey`
   atomically replaces the expired record with payload H-B, execution E-B,
   token T-B, a new expiry, and status `in_flight`.
3. A resumes and issues the terminal-reconciliation update described above.
4. The current filter checks scope and only `status: "in_flight"`. Those
   fields still match B's replacement. A can set the row to completed with
   E-A and A's cached response; the update does not replace H-B, leaving a
   mismatched payload hash/result record.

This is a **PARTIAL / un-reproduced race hypothesis**. The update filter
permits this interleaving at source level, but no deterministic race test or
live MongoDB reproduction was run. If B had already completed its record
before A's update, A's `status: "in_flight"` predicate would not match; the
risk is specifically the interval in which B has claimed/replaced the key
but it remains in flight.

### 3. Proposed minimal atomic conditional update

For terminal reconciliation, issue one MongoDB atomic
`findOneAndUpdate`/equivalent through the existing `updateRecord` dependency.
Build the filter from the exact observation and require:

```text
tenantId
workflowId
key
status: "in_flight"
executionId: observed executionId
payloadHash: observed payloadHash
reservationToken: observed reservationToken (including exact null for legacy rows)
updatedAt: observed updatedAt, when present
```

The unique scope plus status and the observed execution/hash/token prevent an
older reconciliation from completing a replacement claim. Matching the
observed timestamp adds a compare-and-set guard for legacy rows and any
same-token state mutation. If the schema can contain tokenless rows, the
query must match null/missing token consistently and must not omit the
ownership predicate merely because the observed value is null. Do not invent
a new field name; `reservationToken` and existing timestamps already exist.
Whether timestamp comparison is needed in addition to the token should be
confirmed against Mongoose's `updatedAt` behavior for all update paths.

Check the result of the atomic update. A zero-match/null result means this
operation is stale: it must not report a persisted reconciliation or return
its stale response as if it had won. Return an explicit
`UNCERTAIN_RETAIN`/equivalent internal outcome and allow the normal caller to
re-read/reconcile on a later request. Do not add a retry loop that can claim
ownership without rechecking the execution and reservation. A matched
updated document allows the current reconciliation result to be returned.

This preserves existing API semantics: same tenant/workflow/key and same
payload still replay the stored terminal result; a different payload remains
a conflict; an active duplicate remains in flight; and only the currently
observed reservation can be completed. This proposal introduces no automatic
execution retry, DLQ, public API change, or schema change.

### 4. Affected files proposed for a later approved implementation

| File | Proposed change | Reason |
|---|---|---|
| `backend/src/services/executionIdempotency.ts` | Add the observed-state predicate to the terminal reconciliation update; check the conditional update result and represent a stale no-match without claiming reconciliation succeeded. | This is where the insufficient terminal CAS filter and unchecked update result currently reside. |
| `backend/src/services/executionIdempotency.test.ts` | Add deterministic memory-backed race tests for stale token, current-token success, and concurrent conflicting update; retain/add replay, payload-conflict, and tenant-isolation assertions as needed. | Existing tests already use `createMemoryIdempotencyDependencies` and are the smallest fast regression suite. |
| `backend/src/services/executionIdempotency.integration.test.ts` | Add an optional isolated MongoDB CAS/concurrency regression only if approved test infrastructure is available. | Unit fakes cannot prove MongoDB atomic matching semantics under actual concurrent writes. This test must never target shared/production data. |

No schema/model/index file is expected to change: the current token, status,
execution ID, hash, and timestamps suffice. No API route/contract change is
expected. If implementation discovers legacy records cannot be safely
distinguished using their current fields, stop and request schema approval
rather than weakening the CAS.

### 5. Proposed regression tests

| Test | Arrange and action | Expected result | Suitable evidence |
|---|---|---|---|
| Stale-token rejection | A observes T-A and terminal E-A; replace the record with a B reservation using T-B before A's update. | A's CAS matches zero records; B's in-flight state, token, payload hash, execution ID, and expiry remain unchanged; A does not report successful persistence. | Memory dependency test; ideally also isolated MongoDB integration. |
| Current-token reconciliation | A observes current token and terminal execution; make no intervening change. | Exactly the observed record becomes completed with the reconstructed response; the result reports success. | Memory dependency test plus optional isolated MongoDB integration. |
| Concurrent reservation changes | Race a terminal CAS with a replacement/completion using a different token/state. | Only an operation whose filter matches the currently stored token/state succeeds; the newer reservation is not overwritten. | Deterministic memory test; MongoDB test needed to establish database atomicity under real concurrent operations. |
| Terminal result replay | Complete reconciliation for one tenant/workflow/key/payload, then submit same key and payload again. | The stored terminal response (including a failed terminal execution where applicable) is replayed unchanged; no second execution is created. | Existing memory tests cover completed/failed reconciliation and cached response; route-level exact replay assertion may be added if absent. |
| Payload conflict | Reuse the same scope/key with a different canonical payload. | Existing mismatch/HTTP 409 behavior remains unchanged and original record is preserved. | Existing memory and route tests already cover conflict; retain as regression assertion. |
| Tenant isolation | Use an observed token from Tenant A against an otherwise matching Tenant B reservation. | No Tenant B document matches/changes. | Memory test; a database test is optional only for Mongo query semantics. |

Existing named coverage includes canonicalization and scope tests,
`reconcileInFlightReservation: existing completed execution reconciles and
persists completed response`, `... existing failed execution returns
recorded failure outcome per contract`, and the `fencing token: Request A
paused ... Request B ...` test in
`backend/src/services/executionIdempotency.test.ts`. Existing replay and
payload mismatch route cases are in
`backend/src/routes/execution.routes.test.ts`. No test for the exact stale
terminal-reconciliation interleaving was found. All tests above are plans;
none were run in this phase.

### 6. Cross-tenant route-level test plan

Authentication is implemented by `backend/src/middleware/tenantAuth.middleware.ts`
and `backend/src/services/tenantResolver.ts`; API key identity is hashed and
the resolved tenant ID is passed to the route service. Global routes are
registered through `backend/src/app.ts` and implemented in
`backend/src/routes/execution.routes.ts`.

| Scenario | Existing evidence | Proposed additional test / expected behavior |
|---|---|---|
| History cross-tenant access: Tenant A asks for data containing Tenant B records | **PARTIAL** — service test asserts the global history query contains trusted `tenantId`; current route test proves the per-workflow history response is empty for the other tenant, not the global endpoint. | Add one global-history route/service composition test with two-tenant fixture records and Tenant A API key. Assert only A's records are returned and query uses A's tenant ID. Include `tenantId=B` query input and verify it cannot change authorization. |
| Summary isolation: authenticated A with mixed-tenant fixture data | **PARTIAL** — existing summary route test confirms authenticated tenant is forwarded; service test asserts aggregation begins with `$match: { tenantId }`. The existing route test does not aggregate a mixed-tenant dataset. | Prefer one combined route/service test that runs the actual service with a fake aggregate dependency that honors/captures the `$match`; assert B's fixture is excluded and A's counts are returned. |
| Detail cross-tenant access: A requests B's execution ID | **VERIFIED in route test** — `does not return another tenant's execution details or compensation metadata` expects HTTP 404 `EXECUTION_NOT_FOUND`. Service query is tenant-scoped. | No duplicate test needed; retain the existing test. |
| Missing identity | **VERIFIED for summary; PARTIAL for all endpoints** — summary without API key returns HTTP 401 `UNAUTHORIZED`; middleware is applied to global history and detail as well. | No new test needed unless uniform coverage across each route is required; preserve existing 401 contract, do not invent a status. |
| Valid same-tenant access | **VERIFIED** — detail returns 200; history route tests return fixture data. Summary returns 200. | No additional test needed for the basic success path. |

The smallest useful added coverage is two combined global-route/service tests:
one history test and one summary aggregation test. The detail isolation and
missing-key tests already exist. These additional tests should use the
existing ephemeral HTTP server, resolver test keys, and injected/fake
database dependencies; no shared or production database is necessary.

### 7. Recovery worker minimum-safe integration checklist

The recovery worker remains unstarted and unwired. Minimum requirements
before any future integration:

| Area | Minimum safe requirement |
|---|---|
| Database and indexes | Await successful database connection, then explicitly initialize/verify the required unique reservation index before recovery starts. Decide whether TTL index readiness is required for service readiness, separately from application-level expiry checks. Fail startup or keep recovery disabled with a visible error if required index setup/verification fails. Do not claim TTL deletion from the schema declaration. |
| Tenant discovery | Define an approved source of active tenant IDs and lifecycle events. The existing worker accepts one tenant ID; define startup enumeration, newly provisioned tenant onboarding, inactive/deleted tenant behavior, and whether a worker is created per tenant or scans all tenants safely. No supported recovery-worker enumeration contract is currently wired. |
| Multi-instance coordination | Define an explicit distributed lease/election or prove idempotent CAS semantics for every transition. Specify lease owner/token, expiry, renewal, crash takeover, and what happens when an old process resumes after lease expiry. Local `isReconciling` is not distributed coordination. |
| Reservation fencing | Every recovery write must include tenant/workflow/key, current status, observed token (including legacy null behavior), and observed execution/payload/state fields needed for CAS. Check the atomic update result; no-match is stale work, not success. Cover both missing-execution claims and terminal reconciliation. |
| Error reporting | Replace the interval's swallowed `.catch(() => {})` with structured logger output and observable counters/alerts. Define bounded infrastructure retry/backoff separately; do not make that an execution retry. Avoid logging API keys or payload/customer data. |
| Graceful lifecycle | After database/index readiness, start recovery only after its tenant/lease prerequisites are satisfied. On shutdown, stop scheduling new sweeps, await the current sweep, release/expire distributed ownership safely, then stop database resources. Startup failure must clean up any partially started worker and fail visibly. Add tests for ordering, failures, in-flight stop, and idempotent shutdown. |

Coordinator/Saransh decisions needed before worker integration: tenant
enumeration source and provisioning lifecycle; required index/readiness
policy; distributed lease/election semantics and lease duration; behavior on
index initialization failure; structured error/alerting and infrastructure
retry policy; and shutdown/drain timeout. The 24-hour record retention
duration is still proposed and requires separate policy approval.

### 8. Proposed acceptance criteria

1. A deterministic test demonstrates the stale terminal reconciliation
   interleaving and passes only when the old operation cannot alter the
   replacement reservation.
2. A current-token terminal reconciliation updates exactly one matching
   record; no-match is surfaced as stale/uncertain and never reported as a
   successful persisted reconciliation.
3. Existing same-payload replay, changed-payload conflict, in-flight
   duplicate, terminal-failure replay, and tenant-isolation behavior remains
   unchanged.
4. An isolated MongoDB test, if approved and available, confirms actual
   conditional update behavior under concurrent writes; no shared or
   production URI is used.
5. Two cross-tenant tests cover global history and summary aggregation using
   authenticated tenant context and mixed-tenant fixtures.
6. Existing detail 404 and missing-auth 401 contracts remain unchanged.
7. TypeScript build and selected tests pass after implementation; commands,
   results, and environment assumptions are recorded. No automatic retry,
   DLQ, API, or schema change is introduced without separate approval.

### 9. Risks, rollback, and rough effort estimate

Primary risks are legacy rows with missing/null token, timestamp behavior
under Mongoose updates, a stale operation returning a response before
confirming its write, and false-positive confidence from fake dependencies
that do not reproduce database concurrency. The plan therefore requires
explicit legacy-null matching, checking the atomic result, and labeling
memory-only evidence separately from MongoDB evidence.

Rough estimate (planning estimate, not measured): about 4–8 engineering
hours for the service CAS, deterministic unit tests, route-level tenant tests,
and targeted validation; add about 4–8 hours if an approved isolated
MongoDB concurrency regression environment is available and needs adaptation.
Recovery-worker readiness/integration is a separate, decision-dependent
effort and is not included.

If an approved implementation fails tests, rollback should be limited to the
specific implementation diff after review. Do not reset the branch or remove
the existing report, protected untracked files, or stash. No rollback action
is authorized or performed by this plan.

### 10. Approval boundary

This plan does not authorize implementation. Explicit approval from
Saransh/coordinator is required before changing source or tests, including
approval of the proposed CAS fields and stale-outcome behavior. A schema
change, API change, worker startup, MongoDB test target, retention policy,
tenant-discovery model, or distributed lease design each requires its own
explicit decision if later found necessary.
