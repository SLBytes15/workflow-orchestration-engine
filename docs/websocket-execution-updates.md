# WebSocket Execution Updates

## Status and evidence labels

This document separates the team's **APPROVED DESIGN** from what is visible
in this repository. Code evidence is limited to the current `member/mahak`
branch; no other branch or teammate implementation was inspected.

- **APPROVED DESIGN** — agreed MVP behavior, not proof of implementation.
- **IMPLEMENTED** — present in the inspected source.
- **UNIT-TESTED / INTEGRATION-TESTED** — covered by an existing test of the
  stated type. A proposed QA case is not evidence that the feature has been
  tested.
- **UNVERIFIED** — no implementation or test evidence was found.
- **PENDING BACKEND/FRONTEND INTEGRATION** — design is approved, but the
  required implementation is not present on this branch.

## A. Overview and scope

**APPROVED DESIGN:** Add live notifications for workflow execution lifecycle
updates. REST remains the source of truth for execution history, details, and
the latest persisted state. WebSocket is an additional best-effort channel;
clients recover current state through REST.

The MVP is limited to execution lifecycle notifications. It does not provide
durable delivery, replay, exactly-once delivery, workflow editing events,
general-purpose application events, or a distributed execution/worker system.

**IMPLEMENTED:** The current execution interface retrieves workflow and
execution data through REST. No WebSocket lifecycle publisher or client is
present in the inspected source.

## B. Architecture

### Approved design

- Use the lightweight `ws` library, attached to the existing Node HTTP server.
- Serve WebSocket connections at `/ws/executions`.
- Issue short-lived connection tickets through an authenticated
  `POST /api/executions/ws-ticket` REST endpoint.
- Return `{ "ticket": "<short-lived-token>", "expiresAt": "<ISO-8601 timestamp>" }`.
- Present the ticket as `?ticket=<encoded-ticket>`; never put API keys or other
  long-lived credentials in the WebSocket URL.
- Send only execution lifecycle events; REST remains authoritative.

### Current branch

The Express application mounts execution routes under `/api/workflows` and
`/api/executions` in [backend/src/app.ts](../backend/src/app.ts). The execution
router currently provides authenticated REST start, history, and detail routes
in [backend/src/routes/execution.routes.ts](../backend/src/routes/execution.routes.ts).
The server starts the Express app with `app.listen` in
[backend/src/index.ts](../backend/src/index.ts); it does not attach a WebSocket
server.

There is no `ws` dependency in [backend/package.json](../backend/package.json),
no `/ws/executions` handler, and no `POST /api/executions/ws-ticket` route on
this branch. Consequently, no ticket response shape or WebSocket ticket
transport is established by code. Do not treat either as an implemented API
contract.

The authenticated REST execution routes use `tenantAuthMiddleware`. It reads
`x-api-key`, resolves it to a tenant, and places the resolved tenant ID in
server-side request context. The database-backed resolver rejects missing,
inactive, revoked, or expired API keys and missing or inactive tenants; the
middleware returns `401` when the key is missing or unresolved. This is
existing REST authentication, not WebSocket ticket authentication.

## C. Authentication and ticket lifecycle

### Approved design

A client first calls the ticket endpoint using the existing authenticated REST
client. The approved response is
`{ "ticket": "<short-lived-token>", "expiresAt": "<ISO-8601 timestamp>" }`.
A ticket must be cryptographically unpredictable, valid for 60 seconds,
stored in memory for this MVP, single-use, and bound server-side to the tenant
resolved from the API key. The frontend presents it as
`?ticket=<encoded-ticket>`. Missing, invalid, expired, and previously used
tickets must be rejected. A client-supplied tenant ID must never establish
authorization. API keys must never appear in the WebSocket URL.

### Current branch

The authenticated REST middleware and tenant resolver are implemented in
[backend/src/middleware/tenantAuth.middleware.ts](../backend/src/middleware/tenantAuth.middleware.ts)
and [backend/src/services/tenantResolver.ts](../backend/src/services/tenantResolver.ts).
The approved response shape, query transport, and security properties are
**APPROVED DESIGN** only. Ticket issuance, response, storage, expiry,
single-use enforcement, unpredictable generation, and WebSocket handshake
rejection are **NOT IMPLEMENTED**, **UNTESTED**, and
**PENDING BACKEND/FRONTEND INTEGRATION**.

## D. Tenant isolation

**APPROVED DESIGN:**

- Bind each accepted socket to the tenant identity associated with its
  server-issued ticket.
- Deliver only events for executions owned by that tenant.
- Verify execution ownership using server-side execution context.
- Never broadcast lifecycle events globally or authorize from a client-supplied
  tenant ID.
- Remove disconnected sockets and their event listeners.

**IMPLEMENTED:** Execution REST service reads and updates are scoped by
`tenantId` in [backend/src/services/execution.service.ts](../backend/src/services/execution.service.ts).
The execution route tests include tenant-authentication and tenant-scoped
execution cases in
[backend/src/routes/execution.routes.test.ts](../backend/src/routes/execution.routes.test.ts).
There is no socket registry or tenant-scoped WebSocket delivery on this branch.

## E. Event contract

### Approved event names

| Event | Approved meaning |
|---|---|
| `execution.updated` | An execution lifecycle update using its actual persisted status. |
| `execution.completed` | The persisted execution has reached status `completed`. |
| `execution.failed` | The persisted execution has reached status `failed`. |

Approved envelope:

```json
{
  "type": "execution.updated",
  "data": {
    "executionId": "<execution id>",
    "workflowId": "<workflow id>",
    "status": "<actual persisted execution status>",
    "updatedAt": "<ISO-8601 timestamp>"
  }
}
```

The same approved data fields apply to the named event envelope; no additional
payload fields are approved here. Publish only after the corresponding
persistence operation succeeds. The `completed` and `failed` event types must
match the actual persisted terminal status. A send failure must not change or
fail workflow execution.

### Persisted statuses visible in code

The execution model defines these persisted statuses:
`queued`, `running`, `completed`, `failed`, `compensating`, `compensated`, and
`compensation_failed`. The frontend API type lists the same values.

The service creates a `queued` record, persists the transition to `running`,
persists runtime compensation checkpoints, and persists the final runtime
result. These writes are visible in
[backend/src/services/execution.service.ts](../backend/src/services/execution.service.ts);
the schema is in [backend/src/models/WorkflowExecution.ts](../backend/src/models/WorkflowExecution.ts).
There is no event publisher after these writes on this branch.

Do not map `compensated` or `compensation_failed` to `execution.completed` or
`execution.failed` without an approved semantic decision. The code confirms
those persisted status values but does not define their WebSocket event
mapping. `updatedAt` must represent the persisted update time and be serialized
as ISO-8601; no WebSocket serialization is implemented yet.

Never include API keys, secrets, stack traces, private script contents, or
unrelated tenant data in an event. No WebSocket payload is currently emitted
or tested.

## F. Frontend reconnect behavior

### Approved design

1. Load execution history through REST as the initial view.
2. Obtain a short-lived ticket through the authenticated REST client.
3. Connect to `/ws/executions`.
4. Validate the event name and payload before applying it to the matching
   execution.
5. Reconnect with bounded backoff after an unexpected disconnect.
6. Obtain a fresh ticket for each reconnect attempt that establishes a new
   connection.
7. Refetch current execution state through REST after reconnect.
8. Close the socket and remove handlers when the component unmounts or its
   connection context changes.

REST history, pagination, manual refresh, loading, error, and empty states
remain usable while the socket is disconnected. Do not introduce polling loops
or simulated updates.

### Current branch

[frontend/src/pages/ExecutionsPage.tsx](../frontend/src/pages/ExecutionsPage.tsx)
loads workflows and paginated execution history, supports manual REST refresh,
and fetches execution details. Requests use the REST client in
[frontend/src/api/executionApi.ts](../frontend/src/api/executionApi.ts).
There is no ticket request, WebSocket connection, event validation, bounded
reconnect backoff, fresh-ticket reconnect, reconnect refresh, or socket
cleanup implementation in the inspected frontend source.

## G. Error handling and graceful shutdown

### Approved behavior and required implementation

- Reject missing, invalid, expired, and reused tickets without revealing
  internal details.
- Handle socket connection, close, and error events without exposing secrets
  or internal errors to clients.
- Treat event-send failures as best-effort notification failures; they must not
  fail or roll back execution.
- During graceful shutdown, stop accepting WebSocket connections, close
  existing sockets, remove socket/event listeners, and then complete server
  shutdown.

### Current branch

The existing server shutdown in
[backend/src/index.ts](../backend/src/index.ts) stops the change-stream watcher
and closes the HTTP server. Since no WebSocket server or socket listeners are
registered, WebSocket rejection, send-failure isolation, and socket cleanup
are **UNVERIFIED** and **PENDING BACKEND/FRONTEND INTEGRATION**. Shutdown
integration must be added alongside the WebSocket server; the current HTTP
shutdown alone is not evidence that WebSocket resources are cleaned up.

## H. Backend QA test matrix

These are required verification cases, not claims of existing coverage. No
WebSocket-specific implementation or tests were found on this branch.

| ID | Scenario | Expected result | Verification type |
|---|---|---|---|
| BE-01 | Issue a ticket with a valid API key | Return a ticket bound to the tenant resolved by server-side authentication; do not return or log the API key. | REST integration |
| BE-02 | Review ticket generation | Ticket bytes come from a cryptographically secure random source; predictable generation is rejected. Do not treat a small random-sample uniqueness check as proof of unpredictability. | Code-path/security review |
| BE-03 | Use a ticket at its 60-second expiry boundary | A ticket is accepted only before expiry and rejected at/after expiry. | Unit test with controlled clock |
| BE-04 | Reuse an accepted ticket | The second handshake is rejected. | WebSocket integration |
| BE-05 | Omit a ticket or present an invalid/reused/expired ticket | Reject the handshake; do not disclose internal details. | WebSocket integration |
| BE-06 | Supply or alter a client tenant ID | It does not change the ticket's server-bound tenant or grant access. | WebSocket integration |
| BE-07 | Connect sockets for two tenants and persist an execution update for one | Only sockets bound to the execution's owning tenant receive the event. | Multi-tenant integration |
| BE-08 | Request or publish an execution owned by another tenant | Access is denied/not delivered; no cross-tenant execution data is disclosed. | Service and WebSocket integration |
| BE-09 | Serialize each approved event | Event name and envelope contain only `executionId`, `workflowId`, persisted `status`, and ISO-8601 `updatedAt`. | Unit/contract test |
| BE-10 | Persist `completed` or `failed` terminal result | Emit the corresponding `execution.completed` or `execution.failed` event with the actual persisted status; do not invent mappings for compensation statuses. | Service integration |
| BE-11 | Persistence succeeds or fails before publication | Publish only after a successful write; publish nothing for a failed or unconfirmed write. | Service integration with publisher spy |
| BE-12 | Event send throws or the socket is not writable | Record/handle the notification failure without changing the execution outcome or failing the workflow request. | Unit/integration |
| BE-13 | Close a client socket | Remove the socket and associated listeners; later events are not sent to it. | WebSocket integration |
| BE-14 | Gracefully shut down the server with connected clients | Stop accepting connections, close sockets, remove listeners, and complete HTTP server shutdown. | Server lifecycle integration |

## I. Frontend QA test matrix

These are required verification cases; they are not existing WebSocket test
results.

| ID | Scenario | Expected result | Verification type |
|---|---|---|---|
| FE-01 | Open the executions page with valid REST authentication | Workflows and the first history page load through REST with existing loading, error, and empty states intact. | Component/API test |
| FE-02 | Receive a valid approved event for a listed execution | Update only that execution using the validated actual status. | Component test |
| FE-03 | Receive an unknown event name | Ignore it without changing execution state or crashing. | Unit/component test |
| FE-04 | Receive malformed JSON or a malformed event payload | Reject it safely; preserve the current REST-backed view. | Unit/component test |
| FE-05 | Receive an event whose execution ID is not in the applicable tenant/workflow view | Ignore it; do not attach it to another execution or display unrelated data. | Component test |
| FE-06 | Receive `execution.completed` or `execution.failed` | Apply only when the payload status matches that actual terminal state; do not infer compensation mappings. | Component test |
| FE-07 | Lose the WebSocket connection | Existing REST history, pagination, detail, and manual refresh remain usable; no fake status update occurs. | Component test |
| FE-08 | Reconnect repeatedly | Retry delays follow a bounded backoff and do not create an unbounded retry loop. | Unit test with controlled timers |
| FE-09 | Reconnect successfully | Refetch current execution state/history through REST to recover changes missed while disconnected. | Component/API test |
| FE-10 | Unmount the page or change authenticated connection context | Close the socket and remove handlers; stale events do not update the page. | Component test |
| FE-11 | Use pagination and manual refresh while disconnected | REST history and pagination continue to work without a WebSocket connection. | Component/API test |

## J. Known limitations and future improvements

The approved MVP intentionally has these limitations:

- Tickets are held in memory.
- Connection tracking is single-process.
- Notifications are best-effort and non-durable.
- Missed events are not replayed.
- There is no exactly-once delivery guarantee.
- There is no multi-instance pub/sub or horizontal scaling.

Possible future work includes shared ticket/connection infrastructure,
multi-instance event distribution, durable replay, and explicit delivery
semantics. These are outside the approved MVP and must not be implied by this
contract.

## K. Reviewer demo checklist

Use real backend persistence and real WebSocket integration for this demo; fake
timers or simulated updates are not proof of end-to-end behavior.

1. Load an execution history page through REST.
2. Obtain a ticket through authenticated REST and establish a connection to
   `/ws/executions`.
3. Trigger a real workflow execution state transition.
4. Observe the corresponding approved event and confirm its status against the
   persisted execution record.
5. Disconnect and reconnect the client.
6. Confirm the reconnect causes a REST refresh and recovers the latest state.

This flow cannot currently be demonstrated from the inspected branch because
the backend and frontend WebSocket integrations are pending.

## L. Implementation status matrix

| Feature | Approved design | Implemented | Tested | Evidence/notes |
|---|---|---|---|---|
| Authenticated REST execution history and details | Approved; REST is authoritative | Implemented | Route/service tests use injected dependencies | `backend/src/routes/execution.routes.ts`; no WebSocket behavior covered |
| REST API-key authentication and server-derived tenant context | Approved prerequisite | Implemented for REST | Route tests cover missing/invalid keys and tenant context; no live-database auth integration claimed | `backend/src/middleware/tenantAuth.middleware.ts`; `backend/src/services/tenantResolver.ts` |
| `POST /api/executions/ws-ticket`, approved response, unpredictable tenant-bound 60-second single-use ticket | Approved | Pending | No ticket tests | No ticket route or ticket store |
| `/ws/executions`, ticket query handshake, and rejection behavior | Approved | Pending | No WebSocket tests | No `ws` dependency or WebSocket handler |
| Tenant-bound sockets and tenant-scoped event delivery | Approved | Pending | No WebSocket tenant-isolation tests | REST is tenant-scoped; no socket registry or publisher |
| Event names/envelope and publish-after-persistence | Approved | Pending | No event contract/publisher tests | No event is emitted; status-to-terminal-event mapping for compensation statuses needs an explicit rule |
| Send-failure isolation | Approved | Pending | No tests | No socket send path exists |
| Bounded reconnect with fresh ticket, then REST refresh | Approved | Pending | No frontend WebSocket tests | Frontend currently uses REST only |
| Persisted execution status values | Approved payload must use actual values | Implemented in REST persistence | Service tests cover lifecycle states; no WebSocket serialization test | `backend/src/models/WorkflowExecution.ts`; `backend/src/services/execution.service.ts` |
| WebSocket cleanup and graceful shutdown | Approved | Pending | No tests | No WebSocket resources exist to clean up |

**Overall:** The lifecycle notification architecture is **APPROVED DESIGN**;
backend and frontend WebSocket work is **PENDING BACKEND/FRONTEND INTEGRATION**.
The existing REST execution flow is implemented, but it does not establish
that any WebSocket requirement is implemented or tested.
