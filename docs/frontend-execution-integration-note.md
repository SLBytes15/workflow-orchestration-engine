# Frontend Execution API — Integration Note

Status: **pre-implementation**. This note defines how the UI will consume the
execution API. No execution UI or API client code is included, because the
response envelope is not yet agreed.

Author: Nithin
Date: 17-Oct-2026
Related: `docs/workflow-graph-contract.md`, `docs/workflow-api-auth-contract.md`,
`docs/workflow-execution-contract.md` (pending, Saransh)

---

## 1. Scope

This note covers, for the frontend only:

- starting an execution for a workflow,
- displaying `queued` / `running` / `completed` / `failed`,
- fetching a single execution's status,
- fetching tenant-scoped execution history with limit/cursor pagination,
- loading, empty and error states.

Out of scope: the execution engine itself, Saga compensation UI, cancel/resume
controls (not in the approved v1 baseline), and any change to the workflow canvas.

---

## 2. Approved baseline this note relies on

| Operation | Method + path | Expected success |
|---|---|---|
| Start / enqueue execution | `POST /api/workflows/:workflowId/executions` | `202 Accepted` |
| Execution status/details | `GET /api/executions/:executionId` | `200 OK` |
| Workflow execution history | `GET /api/workflows/:workflowId/executions` | `200 OK` |

Rules taken as fixed:

- The tenant is derived server-side from the API-key tenant context. The UI
  **must never** send `tenantId` in a body, query string or header.
- Errors use `{ error: { code, message } }`. The UI surfaces `message` and never
  renders a stack trace.
- `202` means the run was accepted for processing. It does **not** mean the
  workflow completed, and the UI must not display `completed` or `success` on
  the basis of the start response alone.
- Initial states are `queued`, `running`, `completed`, `failed`. `compensating`
  is not part of the baseline; the UI will only add it if the contract adds it.

---

## 3. Existing frontend patterns to reuse

Verified against `main` at `e1d08ce`:

| Concern | Current implementation |
|---|---|
| HTTP | `frontend/src/api/workflowApi.ts` — one module per API area, `fetch`, `Content-Type: application/json` |
| Base URL | `import.meta.env.VITE_API_BASE_URL`, trailing slashes stripped, default `http://localhost:3000` |
| Auth | `X-API-Key` header; key comes from `import.meta.env.VITE_API_KEY` in `App.tsx`; never `localStorage` |
| Errors | Parse `{ error: { code, message, details } }`, throw `Error(message)`; UI shows inline text |
| Navigation | `useState<Page>` in `App.tsx`; **no router library** |
| Workflow ids | Backend list returns Mongo documents mapped via `id ?? _id`; demo cards still use numeric ids |
| Tests | No test runner configured; `package.json` has `dev`, `build`, `lint` (oxlint), `preview` only |

The execution client must follow the same shape rather than introduce a second
HTTP style.

---

## 4. Planned API client (not implemented)

To be added as `frontend/src/api/executionApi.ts` once types are agreed:

```ts
startExecution(workflowId, apiKey)                       // POST, expects 202
getExecution(executionId, apiKey)                        // GET
getWorkflowExecutions(workflowId, { limit, cursor }, apiKey) // GET
```

Rules for that module:

- Reuse `getApiBaseUrl()` behaviour; do not hardcode hosts.
- Send `X-API-Key` only. No tenant identifiers in body or query.
- Reject an empty key locally with `API authentication is not configured.`
  before making a request, matching `workflowApi.ts`.
- Map non-2xx responses to a user-readable message; keep `code` available for
  branching on auth vs not-found.
- Never log the key or the full response body in production builds.

**Blocked:** the response types are not stable, so no TypeScript types are
committed yet. See §11.

---

## 5. State model and display mapping

| API status | UI label | Treatment | Terminal | Polling |
|---|---|---|---|---|
| `queued` | Queued | neutral/amber badge, muted row | no | continue |
| `running` | Running | blue badge, animated indicator | no | continue |
| `completed` | Completed | green badge | yes | stop |
| `failed` | Failed | red badge, `error.message` in detail row | yes | stop |
| `compensating` | — | **not implemented** — pending contract | — | — |

Status must not be conveyed by colour alone: each badge also carries its label,
and status changes are announced through a polite live region.

---

## 6. UI flows

### 6.1 Start an execution

1. User activates **Run** on a workflow card.
2. Button enters a busy state and is disabled to prevent double submission.
3. `POST /api/workflows/:workflowId/executions`.
4. On `202`: show `Queued`, remember the returned execution id, and move to the
   execution detail view.
5. On `401`/`403`: show the authentication message, do not retry automatically.
6. On `404`: the workflow is missing or belongs to another tenant — show
   "Workflow not found" and refresh the list.
7. On `400`: show the API `message`; do not clear the user's form state.
8. On network failure: show a retry affordance; never assume the run started.

Only workflows loaded from the backend have a real id. Demo cards with numeric
ids must have the Run action disabled, with a short explanation, until the page
is fully backend-driven.

### 6.2 Display status

- Poll `GET /api/executions/:executionId` while the status is `queued` or
  `running`.
- Proposed interval: 3 s, with a 5-minute cap and a visible "still running"
  note after 60 s. Interval to be confirmed with Saransh.
- Stop polling on `completed`, `failed`, on unmount, or when the user leaves the
  page. Use an `AbortController` or a `cancelled` flag, as `WorkflowsPage`
  already does for list loading.
- On repeated poll failures: back off, keep the last known status, show a
  non-blocking error with a manual Refresh.

Honesty requirement: while the execution engine is not implemented, a started
run stays `queued`. The UI must show a note such as "Queued — the execution
engine is not processing runs yet" and must never simulate progress.

### 6.3 Execution history

- `GET /api/workflows/:workflowId/executions?limit=20` first page.
- "Load more" sends the returned cursor; cursor is opaque to the UI.
- Append results, de-duplicate by execution id, and keep the server order.
- Default ordering assumed newest-first — to be confirmed.
- Empty response renders the empty state, not an error.

---

## 7. Files requiring changes later

| File | Change |
|---|---|
| `frontend/src/api/executionApi.ts` | **new** — start/status/history calls, mirrors `workflowApi.ts` |
| `frontend/src/api/execution.types.ts` | **new, blocked** — request/response types once contract is agreed |
| `frontend/src/pages/ExecutionsPage.tsx` | **new** — history list, pagination, empty/error states |
| `frontend/src/pages/ExecutionsPage.css` | **new** — page and status styles |
| `frontend/src/components/executions/ExecutionStatusBadge.tsx` | **new** — status label + colour + a11y |
| `frontend/src/components/executions/ExecutionRow.tsx` | **new** — id, status, started/finished timestamps, error summary |
| `frontend/src/App.tsx` | Replace the inline `Executions` placeholder with `ExecutionsPage`; pass `tenantApiKey`; hold selected execution id |
| `frontend/src/components/workflows/WorkflowCard.tsx` | Add optional `onRun`, `isRunning`, `canRun` props and a Run button |
| `frontend/src/pages/WorkflowsPage.tsx` | Wire Run to `startExecution`; handle 202/400/401/404; navigation callback |
| `frontend/src/components/layout/Sidebar.tsx` | **no change** — `Executions` entry already exists |

No routing library is installed; navigation stays state-based in `App.tsx`
unless the team agrees to add a router. No new dependency is required for this
feature.

---

## 8. Loading, empty and error states

| State | Behaviour |
|---|---|
| Loading (first load) | Skeleton rows or spinner with `aria-busy`, not a blank panel |
| Loading (pagination) | Keep existing rows; disable "Load more"; show inline spinner |
| Empty (no runs) | "No executions yet" plus a short explanation and a link back to Workflows |
| Empty (unknown workflow) | "Workflow not found" with a back action |
| Error (network/5xx) | Inline alert with the API message and a Retry button |
| Error (401/403) | "API authentication is not configured or is invalid" — no retry loop |
| Error (404 on execution) | "Execution not found" — expected for another tenant's id |
| Error (400) | Show API `message` next to the triggering control |

Cross-tenant access must surface as not-found, never as another tenant's data.

---

## 9. Manual verification checklist

There is no frontend test runner in this repo, so verification is manual until
one is agreed. Run the backend and frontend locally and execute:

1. **Start** — Run on a backend-loaded workflow → request is `POST`, response is
   `202`, card/row shows `Queued`, no `Completed` shown.
2. **Tenant header** — In DevTools → Network, the request carries `X-API-Key`
   and **no** `tenantId` in payload or query.
3. **Missing key** — build with `VITE_API_KEY` unset → UI reports the
   authentication message and issues no request.
4. **Invalid key** — set a bad key → `401` handled as an inline error, no crash,
   no retry storm.
5. **Cross-tenant / missing workflow** — start an execution for another tenant's
   id → `404` path, "Workflow not found", no data leak.
6. **Status polling** — open a `queued` execution → polls at the agreed interval,
   stops on terminal status, no requests after navigating away.
7. **History** — first page respects `limit`; `Load more` uses the cursor; no
   duplicate rows; empty history shows the empty state.
8. **Error rendering** — force a 500/offline → readable message, Retry works,
   no stack trace in the DOM.
9. **Accessibility** — status readable without colour, Run reachable by keyboard,
   focus moves predictably after navigation.
10. **Build health** — `npm run lint` and `npm run build` both pass.

Record actual results, not expectations.

---

## 10. Non-goals for this slice

- No execution UI until response types are agreed.
- No cancel/resume controls (not in the baseline).
- No changes to the canvas or graph contract.
- No new dependencies.

---

## 11. Open questions for Saransh and Swathi

Blocking before any execution types or UI are written:

1. **Start response envelope** — is it `{ message, execution }` (matching
   `POST /api/workflows`) or a bare `{ execution }`? Where does the execution id
   live: `execution.id`, `execution._id`, or top-level `executionId`?
2. **Id naming** — does the API serialise `_id` or `id`? The workflow list
   currently maps `id ?? _id`, which suggests inconsistency worth fixing here.
3. **History envelope and cursor** — `{ executions, nextCursor }`? Is the cursor
   an opaque string, and is `nextCursor` omitted or `null` on the last page?
4. **Pagination limits** — default and maximum `limit`, and sort order
   (assumed newest-first).
5. **Missing vs cross-tenant** — both `404`, or `403` for cross-tenant? This
   changes whether the UI says "not found" or "not authorised".
6. **Start body** — empty body, or an optional input payload? If input is
   supported in v1, what is its type and size limit?
7. **`compensating`** — included in v1? If yes, is it terminal for the UI and
   does it need its own label?
8. **Polling guidance** — any `Retry-After` header, recommended interval, or
   rate limit the UI must respect?
9. **Execution fields exposed to the client** — are `graphSnapshot` and
   `nodeResults` returned in full, summarised, or omitted? They can be large and
   may contain customer data.

Until 1–3 are answered, the frontend will not commit execution types.