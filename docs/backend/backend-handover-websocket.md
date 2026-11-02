# Backend handover — execution WebSocket updates

**For:** Saransh (integration) and Swathi (frontend contract check)
**From:** Nithin C · `member/nithin` @ `13e558a`
**Date:** 1 November 2026

**Scope:** describes the backend that exists in the repository today, so the frontend can be
checked against it line by line. It is not a proposal and not a change log. Everything below was
read from the committed files on `13e558a`; nothing was inferred from memory or from the design
document.

Line numbers are correct for `13e558a`. If the files move, search the named function instead.

---

## 1. Branch state and what I ran today

| Check | Command | Result |
|---|---|---|
| Branch | `git status -sb` | `## member/nithin...origin/member/nithin` — clean, no ahead/behind |
| HEAD | `git rev-parse --short HEAD` | `13e558a` |
| Remote | `git ls-remote --heads origin member/nithin` | `13e558a57ad3ec576194cf13bc06717bc3224a89` — identical to local |
| Build | `cd backend && npm run build` | `tsc`, no diagnostics, exit 0 |
| Tests | `cd backend && npm test` | `# tests 365`, `# pass 365`, `# fail 0`, `# suites 19`, exit 0 |
| Whitespace | `git diff --check` | no output |

These are results I ran myself on `13e558a`, not reported figures.

---

## 2. Ticket endpoint

`POST /api/executions/ws-ticket` — `backend/src/routes/executionWsTicket.routes.ts:24`,
mounted at `backend/src/app.ts:92`.

| Item | Value |
|---|---|
| Method | `POST` only. Another method on this path is not handled here; it falls through to the execution router mounted on the same prefix (`app.ts:93`), so do not rely on a fixed status for a wrong method. |
| Path | `/api/executions/ws-ticket` |
| Auth header | `X-API-Key` (read as `x-api-key`, case-insensitive) — `tenantAuth.middleware.ts:6` |
| Request body | none; the body is never read, so a client-supplied `tenantId` is ignored |
| Success | `200`, body is exactly `{ "ticket": string, "expiresAt": string }` (`:39-42`) |
| Missing / unknown key | `401` `{ "error": { "code": "UNAUTHORIZED", "message": "A valid API key is required" } }` |
| Resolver throws | `500` via the shared error handler; no ticket is issued |

The tenant is taken from `req.tenantContext`, which the middleware sets from the API key
(`executionWsTicket.routes.ts:25,37`). There is no other source of tenant identity on this route.

Example:

```
POST /api/executions/ws-ticket
X-API-Key: <key>

200 {"ticket":"<43-char base64url>","expiresAt":"2026-11-01T09:15:00.000Z"}
```

---

## 3. Ticket lifecycle

`backend/src/services/executionTicket.service.ts`

| Property | Value | Reference |
|---|---|---|
| Entropy | 32 random bytes, base64url → 43 chars | `:48` |
| TTL | 60 000 ms (`EXECUTION_TICKET_TTL_MS`) | `:3` |
| `expiresAt` | ISO-8601 UTC, computed as `now + ttl` | `:49-55` |
| Single use | record deleted on `consume`, **before** the expiry check, so a ticket cannot be redeemed twice even if the first attempt was late | `:64-82` |
| Expiry | expired ticket is deleted and rejected | `:77-79` |
| Binding | tenant id string captured at issue time; it is not re-validated against the API key at handshake | `:50` |
| Storage | in-process `Map`; lost on restart, not shared between instances | `:31` |
| Sweeping | expired entries are dropped opportunistically on each `issue`, not on a timer | `:35-41,46` |

Consequence for the client: **one ticket per connection attempt.** A reconnect — including one
after a network drop — must call the ticket endpoint again.

---

## 4. WebSocket handshake

`backend/src/services/executionWebSocket.ts:8,106-136`, attached at `backend/src/index.ts:169`.

| Item | Value |
|---|---|
| URL | `ws(s)://<host>/ws/executions?ticket=<ticket>` |
| Path | `/ws/executions` (`EXECUTION_WS_PATH`, `:8`) — a different path is rejected by `ws` itself |
| Auth | ticket in the `ticket` query parameter (`:111-113`) |
| Missing / unknown / expired / reused ticket | server closes the socket with code **`4401`**, reason `Unauthorized` (`:115-117`) |
| Handshake success | no server → client welcome frame; the socket simply stays open and receives events |
| Max client frame | 1 024 bytes (`:11`) |
| Client → server messages | ignored (`:127`); no command channel exists |
| Heartbeat | **none.** No ping/pong; a dead peer is noticed only when a send fails or the socket closes (`:129-135,162-179`) |
| Origin check | **none.** The ticket is the only credential; any origin holding a ticket can connect |
| Tenancy | sockets are bucketed per tenant at connect time (`:120-123`); a socket only ever receives its own tenant's events |
| Port | same HTTP server and port as the REST API — no second listener (`index.ts:168-169`) |
| Attachment point | only `startServer()` attaches it. Code that builds the app with `createApp()` alone has no WebSocket endpoint. |

---

## 5. Event schema and names

```json
{
  "type": "execution.updated",
  "data": {
    "executionId": "<execution ObjectId as 24-hex string>",
    "workflowId": "<workflow ObjectId as 24-hex string>",
    "status": "<persisted status string>",
    "updatedAt": "<ISO-8601 UTC string>"
  }
}
```

Exact types (`executionWebSocket.ts:13-28`, built at `:246-257`): three event types only, and
four data fields only. No `nodeResults`, no `error`, no `tenantId`, no sequence number.

Status → event mapping (`eventTypeForStatus`, `:37-50`):

| Persisted status | Event type |
|---|---|
| `queued` | `execution.updated` (mapping exists; not emitted today — see note) |
| `running` | `execution.updated` |
| `compensating` | `execution.updated` |
| `completed` | `execution.completed` |
| `failed` | `execution.failed` |
| `compensated` | **no event** — returns `null` |
| `compensation_failed` | **no event** — returns `null` |

Note on `queued`: the record is created with `status: "queued"` (`execution.service.ts:203`) but
that creation is not published; the first event a client receives is `running`
(`execution.service.ts:235`). The `queued` mapping is therefore defensive only. A client must not
wait for a `queued` frame.

Ordering: events are emitted in the order their writes complete, one per confirmed write. Delivery
order over the socket follows that, but there is no sequence number, no duplicate suppression and
no replay, so a client must treat `updatedAt`/`status` as authoritative rather than event counts.

---

## 6. Where events are published relative to persistence

Three call sites, all through `safeNotify` (`execution.service.ts:170-179`), which swallows
notifier failures because persistence has already succeeded:

| Site | Line | Published after |
|---|---|---|
| Start | `:235` | the `running` transition write returned a record |
| Compensation checkpoint | `:289` | `persistCheckpoint` confirmed the write |
| Terminal | `:362` | the terminal write returned a record; only reached when `finalExecution` is non-null |

If the terminal write cannot be confirmed, the service throws
`EXECUTION_RESULT_PERSISTENCE_FAILED` (`:342-360`) and **nothing is published** — the client sees
no terminal event and must refresh over REST rather than infer an outcome.

`publishPersistedExecution` (`executionWebSocket.ts:229-261`) is itself total: an unmappable status
returns early, and a hub/publish failure is caught, so a notification can never fail or roll back an
execution.

---

## 7. Statuses that emit nothing — REST refresh required

`compensated` and `compensation_failed` are real persisted terminal states with **no** approved
event mapping, so `publishPersistedExecution` returns early (`executionWebSocket.ts:233-238`) and the
client receives nothing for them.

Concretely, a compensated run delivers `running` → `compensating` → silence. The final state is only
visible with `GET /api/executions/:executionId` (or the list endpoint
`GET /api/workflows/:workflowId/executions`). A client must therefore:

1. refresh over REST when the socket reports any state it does not itself terminate on, and
2. always reconcile once on terminal REST state, never assume "socket went quiet" means failure.

This is deliberate, not an oversight: reporting a rolled-back run as `execution.completed` or
`execution.failed` would be wrong.

---

## 8. File map

Implementation:

| File | Role |
|---|---|
| `backend/src/routes/executionWsTicket.routes.ts` | `POST /ws-ticket`, response shape |
| `backend/src/services/executionTicket.service.ts` | ticket issue/consume, TTL, single-use |
| `backend/src/services/executionWebSocket.ts` | hub, handshake, fan-out, status mapping, publisher |
| `backend/src/services/execution.service.ts` | the three publish points, `safeNotify` |
| `backend/src/app.ts:92` | route mount |
| `backend/src/index.ts:169,112-125` | attach on startup, close on shutdown |
| `backend/src/middleware/tenantAuth.middleware.ts` | API-key → tenant |

Tests (all run by `npm test`):

| File | Covers |
|---|---|
| `backend/src/routes/executionWsTicket.routes.test.ts` | auth required, unknown key, tenant binding, client `tenantId` ignored, two-key isolation |
| `backend/src/services/executionTicket.service.test.ts` | 43-char ticket, uniqueness, 60 s expiry boundary, single use, purge |
| `backend/src/services/executionWebSocket.test.ts` | 4401 on bad/reused ticket, tenant isolation, fan-out, cleanup, status mapping, envelope, no publish for unmapped status, publisher-failure isolation, shutdown |
| `backend/src/services/executionRealtime.integration.test.ts` | real HTTP server + real `ws` client + real `startExecution`, fake persistence, owning tenant only |
| `backend/src/index.test.ts` | attach after listen, close before HTTP listener |

Targeted run:

```
cd backend
npx tsx --test src/routes/executionWsTicket.routes.test.ts \
  src/services/executionTicket.service.test.ts \
  src/services/executionWebSocket.test.ts \
  src/services/executionRealtime.integration.test.ts
```

---

## 9. Limitations

1. **Tickets are in memory, single process.** A restart voids every ticket; a second backend
   instance cannot validate a ticket issued by the first. Horizontal scaling needs a shared store
   (or sticky sessions plus a shared ticket store).
2. **No replay, no exactly-once, no multi-instance pub/sub.** Delivery is best effort: a client that
   is disconnected during a state change misses it and must reconcile over REST.
3. **No heartbeat.** Neither side pings; a half-open TCP connection can look alive until a write
   fails.
4. **Ticket travels in the query string**, so it can appear in proxy/access logs. It is short-lived
   and single-use, which bounds but does not remove that exposure.
5. **No `Origin` validation** on the handshake; the ticket is the sole credential.
6. **Retry is NOT implemented** (`retry` is validated and stripped, never executed — see
   `docs/backend/week3-retry-failure-persistence.md`). `timeoutMs` stops the wait but does not make a
   task retryable.
7. **Compensated terminals emit no event** (§7).
8. **Not live-tested** against a real database, and not multi-instance or load-tested. All WebSocket
   evidence uses fake persistence or an in-process integration harness.

---

## 10. Contract checklist for the frontend check

| # | Item | Backend expectation |
|---|---|---|
| 1 | Ticket request | `POST /api/executions/ws-ticket`, header `X-API-Key`, no body |
| 2 | Ticket response | `{ ticket, expiresAt }` only; `expiresAt` ISO-8601; treat as single use, 60 s |
| 3 | Socket URL | `ws(s)://<host>/ws/executions?ticket=<ticket>`; expect close `4401` on rejection |
| 4 | Event names | `execution.updated` \| `execution.completed` \| `execution.failed` |
| 5 | Payload fields | `data.executionId`, `data.workflowId`, `data.status`, `data.updatedAt` — nothing else |
| 6 | Refresh fallback | required for `compensated` and `compensation_failed`, and after any disconnect or `4401` |

If a client sends `X-API-Key` on the socket upgrade instead of a ticket, it will be closed `4401` —
the socket does not read that header.
