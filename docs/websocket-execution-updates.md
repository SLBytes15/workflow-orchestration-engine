# WebSocket Execution Updates

## Status and evidence labels

This document separates the team's **APPROVED DESIGN** from implementation
evidence. The initial 1 November inspection used the checked-out
`member/mahak` HEAD `bd2775c33179b9363f99e7052b8193d3a5b0d8d7` and stale
remote-tracking refs. The branch was later fast-forwarded to
`b15d510be7c6dae8e263193ff30acbbe620562f4`; the documentation change was
restored from `stash@{0}`. Current status statements below refer to that
fast-forwarded branch and the explicitly identified frontend reference. The
pre-fetch section is retained as historical context only and is superseded
where it conflicts with the later evidence.

- **APPROVED DESIGN** — agreed MVP behavior, not proof of implementation.
- **IMPLEMENTED** — present in the inspected source.
- **UNIT-TESTED / INTEGRATION-TESTED** — covered by an existing test of the
  stated type. A proposed QA case is not evidence that the feature has been
  tested.
- **NOT VERIFIED / NOT RUN** — the behavior or test result was not
  independently verified in this documentation task.
- **SUPERSEDED** — historical finding that must not be read as current status.

## Follow-up verification after fetch — 1 November 2026

### Git references and reported commits

`git fetch --all` succeeded. The local branch was subsequently fast-forwarded
to `b15d510be7c6dae8e263193ff30acbbe620562f4` and matches
`origin/member/mahak`. Updated remote heads recorded during the investigation
include:

| Remote ref | Fetched HEAD |
|---|---|
| `origin/main` | `2dabb05568b35ab1e65432a9792b135f7fdf487e` |
| `origin/member/mahak` | `b15d510be7c6dae8e263193ff30acbbe620562f4` |
| `origin/member/nithin` | `13e558a57ad3ec576194cf13bc06717bc3224a89` |
| `origin/member/swathi` | `c468aef2a79e94b9e16079a3391bcf8260780d91` |

- `27300f2a70466ec1843646c7d5c7d48e41de883f` — authored and committed by
  Nithin on 30 October 2026; `feat(backend): stream execution updates over
  websocket`. It adds the backend WebSocket implementation and tests. It is
  contained in `origin/main`, `origin/member/mahak`, `origin/member/nithin`,
  and `origin/member/swathi`. It is an ancestor of the fetched backend,
  frontend, and Mahak remote heads.
- `be9b818144e0200f7d9826a734259eebb00d320e` — authored and committed by
  Nithin on 30 October 2026; `docs: reconcile verification report with
  committed and pushed state`. It changes only
  `docs/verification/2026-10-30-nithin.md`; it is not the implementation
  commit.
- The initial inspection's `origin/member/nithin` SHA
  `31b865735b11ab2cdcba02f996d70cafbeb25775` was stale. The earlier conclusion
  that no backend implementation existed was correct for the refs then
  inspected, but incomplete after the latest remote refs are fetched.
- At the time of this follow-up investigation, local `member/mahak` was still
  at `bd2775c33179b9363f99e7052b8193d3a5b0d8d7`. It was subsequently
  fast-forwarded, without switching branches, to
  `b15d510be7c6dae8e263193ff30acbbe620562f4`, which matches
  `origin/member/mahak` and contains the merged implementation.

### Backend/frontend contract comparison

The backend implementation is from
`27300f2a70466ec1843646c7d5c7d48e41de883f`, present in
`origin/main` and `origin/member/mahak` and included by the current
`member/mahak` HEAD. The checked-out branch contains frontend realtime commit
`33ffe6e339b996f449fc103c965eca1fb80ed99d`. The later fetched
`origin/member/swathi` head `c468aef2a79e94b9e16079a3391bcf8260780d91`
adds stale-socket callback guards but is not an ancestor of current HEAD;
findings specific to that fix are identified as remote-only below.

| Contract area | Backend actual behavior | Frontend expected/actual behavior | Result |
|---|---|---|---|
| Ticket endpoint | `POST /api/executions/ws-ticket`, mounted at `/api/executions` in `backend/src/app.ts`. | Sends `POST` to `/api/executions/ws-ticket`. | **VERIFIED** |
| Authentication | `tenantAuthMiddleware` requires the existing API key and derives tenant context server-side. | Sends `X-API-Key`; no tenant ID is sent. | **VERIFIED** |
| Ticket response | HTTP 200 JSON with exactly `ticket` and `expiresAt`. | Requires non-empty string `ticket` and parseable future `expiresAt`. | **VERIFIED** |
| Expiry | 60-second TTL; expired tickets are rejected at the expiry boundary. | Checks that returned expiry parses and is in the future; obtains a new ticket per connection attempt. | **VERIFIED** |
| Single-use | Synchronous in-memory map consumption deletes the record before checking expiry; reuse is rejected. This is single-process, not shared/durable storage. | Uses the ticket once for a socket connection and fetches a fresh ticket on reconnect. | **VERIFIED** |
| Tenant binding | Ticket stores the authenticated tenant ID; the handshake registers the socket in that tenant's bucket. | Does not send a tenant identifier in the WebSocket URL. | **VERIFIED** |
| WebSocket URL | Hub accepts `/ws/executions`, reads `ticket` from query parameters, and closes invalid/missing-ticket sockets with code 4401. | Converts HTTP(S) base URL to WS(S), sets `/ws/executions`, and uses `URL.searchParams.set("ticket", ticket)`; API key stays out of the URL. | **VERIFIED** |
| Event names and payload | Status mapping returns `execution.updated` for `queued`, `running`, and `compensating`; `execution.completed` for `completed`; `execution.failed` for `failed`. The service publishes after confirmed running/checkpoint/terminal writes; it does not publish the initial `queued` creation. Envelope is `{ type, data: { executionId: string, workflowId: string, status: string, updatedAt: string } }`, with `updatedAt` serialized as ISO-8601. | Accepts these three event names and the seven persisted statuses, with non-empty IDs and parseable `updatedAt`. It does not enforce that terminal event names match the payload status. | **MISMATCH** — emitted backend events conform, but frontend validation accepts inconsistent terminal name/status pairs. |
| Persistence ordering | Publishes only after a successful, confirmed update; unconfirmed terminal writes throw before notification. | Applies notifications to the current view and reloads REST history after reconnect. | **VERIFIED** |
| Tenant-scoped event delivery | Publishes only to sockets in the tenant's bucket. | Filters events to the selected workflow and execution IDs. | **VERIFIED** |
| Send failure | Send/serialization failures are swallowed and broken sockets removed; they do not throw into execution. | No direct send operation; consumes received messages. | **VERIFIED** |
| Reconnect | No backend reconnect policy; it is client behavior. | On current HEAD, exponential delay starts at 1 second and is capped at 30 seconds; retry attempts are not capped and each attempt obtains a fresh ticket. Reconnect triggers REST history refresh. The stale-socket callback fix is present on fetched `origin/member/swathi` `c468aef2a79e94b9e16079a3391bcf8260780d91`, not current HEAD. | **VERIFIED** for reconnect; **NOT VERIFIED on current branch** for stale-callback guards |
| REST fallback | Authenticated REST history/detail endpoints remain available. | Loads history through REST initially, manually, and after reconnect; REST remains authoritative. | **VERIFIED** |
| Compensation statuses | `compensated` and `compensation_failed` map to no WebSocket event; no unapproved terminal mapping is invented. | The parser accepts both statuses, but backend emits neither via WebSocket; obtain these statuses via REST refresh. | **VERIFIED** |

### Backend implementation and tests inspected

Implementation files added or updated by
`27300f2a70466ec1843646c7d5c7d48e41de883f`:

- `backend/src/routes/executionWsTicket.routes.ts`
- `backend/src/services/executionTicket.service.ts`
- `backend/src/services/executionWebSocket.ts`
- `backend/src/services/execution.service.ts`
- `backend/src/app.ts`
- `backend/src/index.ts`

Backend tests inspected:

- `backend/src/routes/executionWsTicket.routes.test.ts` — auth failures,
  response fields, server-derived tenant, ignored client tenant, and
  multi-tenant ticket binding through in-process route dependencies.
- `backend/src/services/executionTicket.service.test.ts` — 32-byte
  `randomBytes` base64url ticket shape, TTL, expiry boundary, reuse,
  invalid input, and in-memory cleanup.
- `backend/src/services/executionWebSocket.test.ts` — real in-process `ws`
  sockets, missing/invalid/reused ticket rejection, tenant isolation,
  publisher/status mapping, ISO payload, cleanup, and non-throwing failures.
- `backend/src/services/executionRealtime.integration.test.ts` — real
  in-process HTTP/WebSocket client/server and `startExecution`; persistence
  is injected in memory, not a live database.
- `backend/src/services/execution.service.test.ts` — persist-before-notify,
  terminal write confirmation, and notifier failure isolation.
- `backend/src/index.test.ts` — WebSocket attachment and shutdown ordering.

The implementation commit reports 33 added tests. The test sources were
inspected but **not run in this investigation**. The in-process WebSocket
integration is not a live MongoDB or deployed end-to-end test.

### Frontend paths inspected

Latest fetched `origin/member/swathi`:

- `frontend/src/api/executionApi.ts` — authenticated ticket request, response
  expiry validation, and URL construction.
- `frontend/src/api/executionRealtime.ts` — event validation, ticket-per-
  connection, reconnect/backoff, and stale-socket callback guards.
- `frontend/src/pages/ExecutionsPage.tsx` — workflow-scoped updates and REST
  history refresh after reconnect.
- `frontend/tests/executionRealtime.test.ts` — four mock-socket test cases;
  latest commit adds assertions that stale and post-unmount events are ignored.

The latest Swathi commit only changes the realtime client and its tests from
the earlier `33ffe6e339b996f449fc103c965eca1fb80ed99d`; the backend
implementation is now available in its fetched branch through the merge.

### QA evidence and remaining limits

- **Member-reported backend:** `origin/member/nithin`'s 31 October report
  records 365/365 tests passing, build exit 0, and clean `git diff --check`.
  The backend WebSocket commit message separately records 33 added tests and
  360 total at that commit. These results were not rerun here.
- **Member-reported frontend:** 78 frontend tests and four realtime tests
  passed; no live integration result was confirmed. Not rerun here.
- **Personally executed:** no application tests or builds. The commit
  implementation and test sources were inspected; no Atlas writes or live
  tests were performed.
- **Test levels:** ticket/unit and route tests use injected services/fakes;
  WebSocket hub tests use real in-process sockets; the service-to-socket test
  uses in-memory persistence; no live database or deployed end-to-end test is
  verified here.
- Retry execution remains **NOT IMPLEMENTED**. Tickets are in-memory and
  single-process. There is no durable event replay, exactly-once delivery, or
  multi-instance pub/sub guarantee. REST remains the source of truth.

## Initial verification before fetch — 1 November 2026 (SUPERSEDED; historical only)

**Historical result at the pre-fetch snapshot only:** backend WebSocket
support was not found in the references then available. The remote refs were
stale, so the findings below were superseded when the implementation commit
`27300f2a70466ec1843646c7d5c7d48e41de883f` was fetched and the local branch
was later fast-forwarded to `b15d510be7c6dae8e263193ff30acbbe620562f4`.
Nothing in this section describes current implementation status. It remains
to document how the initial discrepancy arose; all statements below are
historical, not current findings.

| Check | Evidence and result |
|---|---|
| Ticket request | **MISMATCH.** The Swathi frontend sends `POST /api/executions/ws-ticket` with `X-API-Key` and no body to the API base URL. `backend/src/app.ts` mounts the existing REST execution router, but `backend/src/routes/execution.routes.ts` has no ticket route in the inspected backend refs. |
| Ticket response | **NOT VERIFIED.** The frontend requires `ticket` and `expiresAt` properties and validates non-empty ticket text plus a parseable future expiry. No backend response exists to compare. |
| Ticket authentication and tenant binding | **NOT VERIFIED.** The frontend sends the API key only to REST. Existing `backend/src/middleware/tenantAuth.middleware.ts` derives tenant context for protected REST routes; there is no ticket route, ticket-to-tenant binding, or handshake authorization to inspect. |
| Ticket security and lifecycle | **NOT VERIFIED.** No backend ticket generator/store/consumer was found. Unpredictability, 60-second lifetime, single-use behavior, atomic consumption, in-memory storage, and expired/reused rejection are not implemented or demonstrated by the inspected backend. The frontend checks that `expiresAt` is valid and in the future; it cannot establish server-side enforcement. |
| WebSocket URL and credential handling | **MISMATCH.** The Swathi client changes the API base protocol from HTTP(S) to WS(S), sets path `/ws/executions`, clears other query parameters, and adds `ticket` through `URL.searchParams.set` (URL encoding). It does not put the API key in the URL. No backend handler accepts this URL. |
| Tenant derivation for the socket | **NOT VERIFIED.** The frontend does not send a tenant ID, but the backend has no ticket handshake from which to derive or enforce a tenant. |
| Event envelope and payload | **MISMATCH.** The frontend parser accepts event names `execution.updated`, `execution.completed`, and `execution.failed`; each event must have `data.executionId` and `data.workflowId` as non-empty strings, `data.status` as one of `queued`, `running`, `completed`, `failed`, `compensating`, `compensated`, or `compensation_failed`, and `data.updatedAt` as a parseable string. No backend event publisher or serializer was found, so no event contract is established end to end. |
| Persistence-before-publish, tenant-scoped delivery, send failure | **NOT VERIFIED.** Execution persistence exists in `backend/src/services/execution.service.ts`, but no publisher follows it. There is no evidence for publish ordering, tenant-scoped socket delivery, or isolating socket send failures from workflow execution. |
| Status/event mapping | **MISMATCH.** The frontend supports the seven persisted status values but accepts the three event names without enforcing that `execution.completed` carries `completed` or `execution.failed` carries `failed`. The backend emits no WebSocket event for any status. In particular, `compensated` and `compensation_failed` have no WebSocket event and must be obtained through REST. |
| Disconnect and REST recovery | **VERIFIED in Swathi frontend source only.** Socket close/error schedules reconnect; delays are exponential from 1 second and capped at 30 seconds, but retry attempts are not capped. Each attempt requests a fresh ticket. On a successful reconnect, `ExecutionsPage.tsx` reloads history through REST; manual history refresh and execution details also use REST. REST remains the source of truth. This behavior is not present on `member/mahak` and has no backend to connect to. |
| Unsupported event/status handling | **VERIFIED in Swathi frontend source only.** Unknown event names, unknown statuses, malformed JSON, and incomplete payloads are ignored by the parser. The UI has an unknown-status label fallback. The parser accepts both compensation statuses for an `execution.updated` event; no backend publication behavior exists. |

### Source and test paths inspected

- Backend: `backend/src/app.ts`, `backend/src/index.ts`,
  `backend/src/routes/execution.routes.ts`,
  `backend/src/routes/execution.routes.test.ts`,
  `backend/src/middleware/tenantAuth.middleware.ts`,
  `backend/src/services/execution.service.ts`,
  `backend/src/services/execution.runtime.ts`, and
  `backend/src/models/WorkflowExecution.ts`.
- Frontend at `origin/member/swathi`:
  `frontend/src/api/executionApi.ts`,
  `frontend/src/api/executionRealtime.ts`,
  `frontend/src/pages/ExecutionsPage.tsx`, and
  `frontend/tests/executionRealtime.test.ts`.
- No backend WebSocket implementation or WebSocket-specific backend test file
  was found in the inspected refs. The frontend realtime test uses a mock
  socket, injected ticket/URL functions, and controlled timers; it is not a
  backend integration or live end-to-end test.

### QA evidence

The following results are **MEMBER-REPORTED, NOT INDEPENDENTLY VERIFIED**:

- **Backend — Nithin:** 365/365 tests passed; backend build passed;
  `git diff --check` was clean. WebSocket unit and in-process integration
  tests reportedly use fake persistence; no live end-to-end test was
  confirmed. The inspected backend refs contain no corresponding WebSocket
  implementation or test path, so those reported WebSocket test results
  could not be tied to source/tests in these refs.
- **Frontend — Swathi:** frontend build passed; 78 frontend tests and four
  realtime WebSocket tests reportedly passed. The inspected remote test source
  contains four test cases using mocks/fakes. Live integration remains
  unconfirmed.

No tests or builds were run for this verification. No Atlas writes or live
tests were performed.

| Evidence category | Status |
|---|---|
| Backend WebSocket implementation | **NOT IMPLEMENTED** in inspected backend refs |
| Frontend WebSocket client | **IMPLEMENTED** at `origin/member/swathi` only; absent from `member/mahak` |
| Frontend realtime unit tests | **UNIT-TESTED WITH MOCKS/FAKES** by member report; not rerun; test file inspected |
| Backend WebSocket unit/in-process integration tests | **MEMBER-REPORTED** only; not independently verified against inspected refs |
| Live end-to-end WebSocket test | **NOT VERIFIED**; member-reported as unconfirmed; checklist below not run |
| Retry execution | **NOT IMPLEMENTED** |

### Manual end-to-end checklist — approved isolated environment only

All items are **NOT RUN**. Do not run experimental writes against shared
MongoDB Atlas M0.

1. **NOT RUN** — Obtain a WebSocket ticket using an authenticated request.
2. **NOT RUN** — Verify the ticket response fields and expiry.
3. **NOT RUN** — Connect using the ticket.
4. **NOT RUN** — Verify that a valid ticket works.
5. **NOT RUN** — Verify expired-ticket rejection.
6. **NOT RUN** — Verify single-use ticket rejection on reuse.
7. **NOT RUN** — Verify tenant A cannot subscribe to tenant B's execution updates.
8. **NOT RUN** — Start an execution and verify event delivery.
9. **NOT RUN** — Confirm persistence succeeds before event publication.
10. **NOT RUN** — Verify completion and failure event payloads.
11. **NOT RUN** — Verify REST refresh after disconnect.
12. **NOT RUN** — Verify `compensated` and `compensation_failed` through REST refresh.
13. **NOT RUN** — Verify reconnect behavior and fresh-ticket acquisition.
14. **NOT RUN** — Verify socket-send failure does not fail workflow execution.

## A. Overview and scope

**IMPLEMENTED — SOURCE VERIFIED:** The current `member/mahak` branch contains
the backend ticket/WebSocket implementation and the frontend realtime client.
WebSocket provides best-effort execution lifecycle notifications; REST remains
the source of truth for history, details, and current persisted state. The
backend implementation is in
[backend/src/services/executionWebSocket.ts](../backend/src/services/executionWebSocket.ts)
and the frontend client is in
[frontend/src/api/executionRealtime.ts](../frontend/src/api/executionRealtime.ts).

The implementation does not provide durable delivery, replay, exactly-once
delivery, multi-instance pub/sub, or retry execution. Live MongoDB/deployed
end-to-end behavior has not been independently verified.

## B. Architecture

**IMPLEMENTED — SOURCE VERIFIED:** The Express app mounts the authenticated
ticket route under `/api/executions` and attaches a `ws` server to the existing
HTTP server. The WebSocket endpoint is `/ws/executions`; the browser obtains
a ticket via REST and supplies it as an encoded `ticket` query parameter.
The API key is sent to the ticket endpoint in `X-API-Key`, never in the
WebSocket URL. The backend returns `{ "ticket": "...", "expiresAt": "..." }`.

Relevant source:
[backend/src/app.ts](../backend/src/app.ts),
[backend/src/index.ts](../backend/src/index.ts),
[backend/src/routes/executionWsTicket.routes.ts](../backend/src/routes/executionWsTicket.routes.ts),
[backend/src/services/executionTicket.service.ts](../backend/src/services/executionTicket.service.ts),
[backend/src/services/executionWebSocket.ts](../backend/src/services/executionWebSocket.ts),
[frontend/src/api/executionApi.ts](../frontend/src/api/executionApi.ts).

## C. Authentication and ticket lifecycle

**IMPLEMENTED — SOURCE VERIFIED:** `POST /api/executions/ws-ticket` requires
the existing API-key tenant-auth middleware. The tenant comes from the
authenticated server-side request context, not a request body or query
parameter. A successful response contains `ticket` and `expiresAt`.
`executionTicket.service.ts` generates 32 random bytes with Node
`randomBytes`, encodes them as base64url, and sets a 60-second expiry. Tickets
are held in an in-memory `Map`, bound to the authenticated tenant, and
consumed once. Consumption deletes the record before checking expiry, so an
expired or previously consumed ticket is rejected and cannot be retried.

The frontend validates that both response fields are usable and that expiry
is parseable and in the future; it does not replace server-side expiry
enforcement. It converts the API base URL to `ws:`/`wss:`, uses
`/ws/executions`, and sets `ticket` via `URL.searchParams.set`, which URL
encodes the value. API keys are not placed in the socket URL.

The in-memory ticket store is process-local and non-durable; tickets are not
shared across backend instances and do not survive restart. Source inspection
verifies use of a cryptographic random generator; this task did not perform a
separate entropy/security assessment.

## D. Tenant isolation

**IMPLEMENTED — SOURCE VERIFIED:** The authenticated ticket stores the
server-derived tenant ID. On handshake, the WebSocket hub consumes the
ticket and groups the socket under that tenant. The publisher sends only to
that tenant's socket set; it does not broadcast execution data globally.
Closed/error sockets are removed from the set. Relevant sources are
[backend/src/middleware/tenantAuth.middleware.ts](../backend/src/middleware/tenantAuth.middleware.ts),
[backend/src/services/executionTicket.service.ts](../backend/src/services/executionTicket.service.ts),
and [backend/src/services/executionWebSocket.ts](../backend/src/services/executionWebSocket.ts).
Corresponding source tests include
[backend/src/routes/executionWsTicket.routes.test.ts](../backend/src/routes/executionWsTicket.routes.test.ts)
and [backend/src/services/executionWebSocket.test.ts](../backend/src/services/executionWebSocket.test.ts).

## E. Event contract

**IMPLEMENTED — SOURCE VERIFIED:** The backend emits the following mapping
from persisted status to event name:

| Persisted status | Event name |
|---|---|
| `queued`, `running`, `compensating` | `execution.updated` |
| `completed` | `execution.completed` |
| `failed` | `execution.failed` |
| `compensated`, `compensation_failed` | No WebSocket event |

The envelope is
`{ type, data: { executionId, workflowId, status, updatedAt } }`.
`executionId`, `workflowId`, `status`, and ISO-8601 `updatedAt` are serialized
as strings. The publisher receives a persisted execution. The service calls
it after confirmed running, compensation-checkpoint, and terminal writes;
the initial creation of a `queued` record does not publish an event.
`compensated` and `compensation_failed` remain persisted statuses but require
REST refresh.

**CONTRACT MISMATCH:** The frontend parser validates that the event name is
one of the three supported names and that the status is one of the persisted
status values, but does not enforce event-name/status pairing. For example,
it accepts `execution.completed` with a non-`completed` status. This is
present in [frontend/src/api/executionRealtime.ts](../frontend/src/api/executionRealtime.ts).
Backend mapping and persistence ordering are implemented in
[backend/src/services/executionWebSocket.ts](../backend/src/services/executionWebSocket.ts)
and [backend/src/services/execution.service.ts](../backend/src/services/execution.service.ts).

## F. Frontend reconnect behavior

**IMPLEMENTED — SOURCE VERIFIED on current `member/mahak` HEAD:** The
executions page initially loads history through REST. On socket close/error,
the realtime client reconnects with exponential delays beginning at 1 second
and capped at 30 seconds; attempts are not capped, so recovery is not
guaranteed. Every connection attempt requests a fresh ticket. When a
reconnection opens, the page refreshes execution history through REST.
REST remains the source of truth. The client closes its current socket and
removes handlers during cleanup.

**STALE CALLBACK NOTE:** The current checked-out realtime client does not
guard every message callback against a replaced socket. A stale-socket
callback fix exists on fetched `origin/member/swathi` commit
`c468aef2a79e94b9e16079a3391bcf8260780d91`, but that commit is not included
in current `member/mahak` HEAD and was not verified as part of this branch's
implementation. Do not attribute that fix to the current branch.

Sources:
[frontend/src/api/executionRealtime.ts](../frontend/src/api/executionRealtime.ts),
[frontend/src/api/executionApi.ts](../frontend/src/api/executionApi.ts),
[frontend/src/pages/ExecutionsPage.tsx](../frontend/src/pages/ExecutionsPage.tsx).

## G. Error handling and graceful shutdown

**IMPLEMENTED — SOURCE VERIFIED:** Missing, invalid, expired, or reused
tickets are rejected during handshake; invalid ticket consumption closes the
socket with code 4401. Socket send/serialization failures are isolated from
workflow execution, and failed/closed sockets are removed from the tenant
registry. The notification helper catches publisher failures, so notification
failure does not propagate into execution.

The backend attaches the WebSocket service to the existing HTTP server.
Shutdown closes the WebSocket service and its sockets before closing the
HTTP server. Relevant files:
[backend/src/services/executionWebSocket.ts](../backend/src/services/executionWebSocket.ts),
[backend/src/index.ts](../backend/src/index.ts),
[backend/src/index.test.ts](../backend/src/index.test.ts).
Source and test inspection is not a claim that shutdown was exercised live.

## H. Backend QA evidence

The following existing test files were inspected, not run during this task:

| Test file | Evidence in test source | Test environment |
|---|---|---|
| [backend/src/routes/executionWsTicket.routes.test.ts](../backend/src/routes/executionWsTicket.routes.test.ts) | Authentication, response fields, server-derived tenant, and ticket route behavior | Injected resolver/ticket dependencies |
| [backend/src/services/executionTicket.service.test.ts](../backend/src/services/executionTicket.service.test.ts) | Random ticket format, TTL/expiry boundary, single use, and invalid input | In-memory ticket service and controlled clock |
| [backend/src/services/executionWebSocket.test.ts](../backend/src/services/executionWebSocket.test.ts) | Handshake rejection, tenant isolation, event mapping/payload, cleanup, and send failures | Real in-process WebSocket sockets |
| [backend/src/services/executionRealtime.integration.test.ts](../backend/src/services/executionRealtime.integration.test.ts) | HTTP/WebSocket client-server path and execution event flow | In-process; injected in-memory persistence, not MongoDB |
| [backend/src/services/execution.service.test.ts](../backend/src/services/execution.service.test.ts) | Persistence-before-notify and notifier-failure isolation | Fakes/injected persistence |
| [backend/src/index.test.ts](../backend/src/index.test.ts) | WebSocket attachment and shutdown ordering | Fake server/watcher dependencies |

**MEMBER-REPORTED, NOT INDEPENDENTLY REPRODUCED — Backend (Nithin):**
365/365 backend tests and the backend build passed; `git diff --check` was
reported clean. These results were not personally rerun. The WebSocket unit
and in-process integration tests use fake/in-memory persistence. No live
MongoDB or deployed end-to-end test was confirmed.

## I. Frontend QA evidence

The current-branch test source
[frontend/tests/executionRealtime.test.ts](../frontend/tests/executionRealtime.test.ts)
contains four mock-based cases covering valid/malformed/unknown event
validation and ticket refresh/reconnect behavior. They do not connect to the
backend. The stale-socket guard added on the newer remote-only commit is not
present in current `member/mahak` HEAD's test source.

**MEMBER-REPORTED, NOT INDEPENDENTLY REPRODUCED — Frontend (Swathi):**
78 frontend tests, four realtime tests, and the frontend build were reported
passing. These results were not personally rerun. Live integration remains
unconfirmed.

## J. Known limitations

- Retry execution is **NOT IMPLEMENTED**.
- WebSocket tickets are held in memory and are single-process only; they are
  not durable or shared between instances.
- There is no durable event replay guarantee or exactly-once delivery
  guarantee.
- There is no multi-instance pub/sub guarantee.
- The initial `queued` execution creation does not emit a WebSocket event.
- `compensated` and `compensation_failed` do not emit WebSocket events;
  refresh from REST to obtain those statuses.
- Frontend event validation does not consistently enforce event-name/status
  combinations.
- Reconnect attempts are not capped; exponential delays are capped at 30
  seconds, but reconnect does not guarantee recovery.
- REST remains the source of truth.
- Live MongoDB/deployed end-to-end integration remains **NOT RUN / NOT
  CONFIRMED**.

## K. Manual end-to-end checklist

All 14 approved-isolated-environment checklist items in the historical
investigation above remain **NOT RUN**. They have not been independently
executed. Do not run experimental writes against shared MongoDB Atlas M0.

## L. Implementation status matrix

| Feature | Current status | Test/evidence status |
|---|---|---|
| Authenticated `POST /api/executions/ws-ticket`; `{ ticket, expiresAt }` response | Implemented — source verified | Route tests inspected; not run |
| Random 32-byte ticket, 60-second expiry, single-use tenant binding | Implemented — source verified; in-memory and single-process | Ticket service tests inspected; not run |
| `/ws/executions?ticket=...` handshake and tenant-scoped socket registry | Implemented — source verified | In-process WebSocket tests inspected; not run |
| Event payload and status mapping | Implemented — source verified; initial queued creation and both compensation terminal statuses emit no event | WebSocket/persistence tests inspected; not run |
| Publish after confirmed persistence | Implemented — source verified | Fake/in-memory persistence tests inspected; not run |
| Socket send/notification failure isolation | Implemented — source verified | In-process/fake test coverage inspected; not run |
| Frontend ticket request, URL, event parsing, reconnect, fresh ticket, REST refresh | Implemented — source verified on current branch | Four mock-based realtime tests inspected; not run |
| Event-name/status pairing validation | Mismatch — frontend does not enforce pairing | Source inspected; no matching validation test |
| Stale-socket callback guards | Present in fetched `origin/member/swathi` commit `c468aef2a79e94b9e16079a3391bcf8260780d91`; not present on current `member/mahak` HEAD | Not verified on current branch |
| Retry execution | Not implemented | Not applicable |
| Durable replay, exactly-once delivery, multi-instance pub/sub | Not implemented / no guarantee | Not verified as runtime properties |
| Live MongoDB/deployed end-to-end behavior | Not verified / not run | No live test evidence |
| Backend 365/365 tests and build; frontend 78 tests and build | Member-reported — not independently reproduced | Not personally run for this report |

**Overall:** Backend and frontend WebSocket behavior described above is
implemented in source on the current branch and has existing mock/in-process
test coverage. This report independently inspected source and test files but
did not execute tests, builds, or live end-to-end checks. Member-reported
results are explicitly identified; all manual E2E checklist items remain
**NOT RUN**.
