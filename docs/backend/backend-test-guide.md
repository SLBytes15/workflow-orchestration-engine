# Backend Test Guide

- **Status:** Draft for team review
- **Owner:** Nithin
- **Scope:** Every backend test file under `backend/src`, the framework used to run them, and what the suite does and does not establish

## 1. Purpose and scope

This guide documents every backend test file currently present in the Zaalima Workflow Orchestration Engine. For each file it records the module exercised, the dependencies that are faked, the behaviours asserted, and the limitations of the coverage.

Scope is `backend/src` only. The repository also contains `backend/dist/**/*.test.js`, which is compiled output of the same sources produced by `npm run build`; `dist/` is git-ignored and those files are not documented separately.

This guide makes no claim about coverage percentages. No coverage tool is configured and no coverage script exists in `backend/package.json`, so any percentage would be unsupported.

## 2. Test framework and discovery

The suite uses Node's built-in test runner (`node:test`) with assertions from `node:assert/strict`. There is no Jest, Mocha, or Vitest dependency and no separate test configuration file.

Discovery is by glob, not by configuration. The test script is:

```json
"test": "tsx --test src/**/*.test.ts"
```

`tsx` executes TypeScript directly, so no build step is required before running tests. There is no mocking library in use:

- Service tests construct hand-written fake implementations of a dependency interface and inject them through a factory function such as `createWorkflowService(dependencies)`.
- Route and middleware tests start a real Express app on an ephemeral port (`listen(0, "127.0.0.1")`) and call it over `fetch`. Tenant resolution is supplied as a stub `TenantResolver` object.
- The only use of runner-provided mocking is `mock.method` in `src/config/database.test.ts`.

Tests are therefore either pure unit tests over injected fakes or in-process HTTP tests. None of them requires a database.

## 3. Verified commands

Run from the `backend` directory:

```powershell
cd backend
npm test
```

Verified output on 28 October 2026:

```
tests 213 | suites 10 | pass 213 | fail 0 | cancelled 0 | skipped 0 | todo 0 | duration_ms 3327.2226
```

Two counts need interpretation:

- `suites 10` counts `describe()` blocks, not files. Ten describes are spread across seven files (`app`, `database`, `validateRequest`, `models`, `execution.runtime`, `executionGraphs.fixture`, `workflow.validator`); the other ten test files declare cases at file level and add no suite.
- 213 exceeds the 209 `test()`/`it()` calls visible in source because `src/services/executionGraphs.fixture.test.ts` generates its cases in a loop over three fixture graphs, two assertions each, plus one standalone case (3 declared calls produce 7 tests, +4).

`npm test` does not type-check the project and does not open a database connection. Type errors are only caught by a separate `tsc` run.

## 4. Test inventory

Seventeen test files, all paths relative to `backend/src`.

| # | Area | File | Tests | Lines |
|---|------|------|-------|-------|
| 1 | Startup | `app.test.ts` | 7 | 133 |
| 2 | Configuration | `config/database.test.ts` | 3 | 38 |
| 3 | Middleware | `middleware/tenantAuth.middleware.test.ts` | 6 | 186 |
| 4 | Middleware | `middleware/validateRequest.middleware.test.ts` | 3 | 109 |
| 5 | Models | `models/apiKey.model.test.ts` | 7 | 93 |
| 6 | Models | `models/models.test.ts` | 28 | 430 |
| 7 | Routes | `routes/execution.routes.test.ts` | 17 | 670 |
| 8 | Routes | `routes/workflow.routes.test.ts` | 12 | 456 |
| 9 | Services | `services/apiKeyCrypto.test.ts` | 4 | 33 |
| 10 | Services | `services/apiKeyManagement.service.test.ts` | 7 | 144 |
| 11 | Services | `services/execution.runtime.test.ts` | 20 | 623 |
| 12 | Services | `services/execution.service.test.ts` | 25 | 1724 |
| 13 | Services | `services/executionGraphs.fixture.test.ts` | 3 | 32 |
| 14 | Services | `services/tenantresolver.test.ts` | 8 | 138 |
| 15 | Services | `services/workflow.service.test.ts` | 14 | 369 |
| 16 | Validators | `validators/workflow-graph.validator.test.ts` | 27 | 319 |
| 17 | Validators | `validators/workflow.validator.test.ts` | 18 | 266 |

The "Tests" column is the number of `test()`/`it()` declarations in the file, not the number of cases that execute, for the reason given in section 3.

## 5. Test files by area

### 5.1 Startup

#### `src/app.test.ts`

- **Module tested:** the composed Express app exported from `./app`, plus `errorHandler`
- **Tests:** 7 in one `describe("Express app")`
- **Type:** HTTP integration, in-process, no database
- **Fakes/injection:** none for the app itself. `app.listen(0, "127.0.0.1")` serves the real app; a second throwaway Express app is built inside one test to exercise `errorHandler` directly.
- **Scenarios:** invalid API key, missing API key, `/api/health`, missing `x-tenant-id`, malformed `x-tenant-id`, valid-format tenant ID, unexpected handler error
- **Key assertions:** 401 `{ error: "Invalid API key" }` and 401 `{ error: "Missing API key" }`; `/api/health` returns 200 `{ status: "ok" }`; missing header returns 400 `"Missing x-tenant-id header"`; `invalid/tenant` returns 400 `"Invalid tenant ID format"`; `tenant-001` returns 200 with the resolved tenant echoed; the error-handler case asserts 500 with code `INTERNAL_SERVER_ERROR` and explicitly asserts the thrown message (`"private internal detail"`) does **not** appear in the body
- **Edge cases covered:** error detail leakage; header presence versus header format treated as distinct failures
- **Does not prove:** behaviour under the real API-key resolver, rate limiting, or anything requiring persistence — `/api/test-tenant` and `/api/test-tenant-context` are diagnostic routes, not the workflow API

### 5.2 Configuration

#### `src/config/database.test.ts`

- **Module tested:** `connectDatabase` from `./database`
- **Tests:** 3 in one `describe("connectDatabase")`
- **Type:** unit with runner-native mocking, no network
- **Fakes/injection:** `mongoose.connect` replaced per test via `mock.method`, restored in `afterEach` through `mock.restoreAll()`
- **Scenarios:** empty connection string, whitespace-only connection string, simulated driver failure
- **Key assertions:** both empty inputs reject with `/MONGODB_URI is not configured/`; a failing connect propagates the original error object by identity (`error === expectedError`)
- **Edge cases covered:** whitespace-only configuration treated as missing
- **Does not prove:** successful connection, retry or timeout behaviour, connection-pool, replica-set, or TLS options. The connection string used is `mongodb://example.invalid/test` and the test expects failure, which is why the suite never touches a real database

### 5.3 Middleware

#### `src/middleware/tenantAuth.middleware.test.ts`

- **Module tested:** `tenantAuthMiddleware`
- **Tests:** 6, no `describe` (file-level cases)
- **Type:** HTTP integration, in-process, no database
- **Fakes/injection:** three hand-written `TenantResolver` stubs in separate Express apps — one resolving `test-valid-key` to a fixed `tenantId`, one always returning `null`, one throwing `Error("Simulated resolver failure")`
- **Scenarios:** client-supplied tenant header, unresolvable key, resolver exception, missing key, invalid key, successful attach
- **Key assertions:** with `x-api-key: test-valid-key` plus `x-tenant-id: attacker-selected-tenant`, the response must carry the resolver's `tenantId` and explicitly `assert.notEqual` the attacker value; unresolved key returns 401; missing key returns 401 with code `UNAUTHORIZED`; a throwing resolver returns 500 with code `INTERNAL_ERROR`, proving `next(err)` forwarding
- **Edge cases covered:** tenant spoofing through a client header; resolver failure distinguished from authentication failure
- **Does not prove:** real key hashing or lookup, revocation, or expiry — those live in `tenantresolver` and are covered separately

#### `src/middleware/validateRequest.middleware.test.ts`

- **Module tested:** `validateRequest` wired to `validateCreateWorkflow`
- **Tests:** 3 in one `describe("validateRequest middleware")`
- **Type:** HTTP integration, in-process, no database
- **Fakes/injection:** none; a minimal Express app mounts the real middleware in front of a handler that echoes `res.locals.validatedBody`
- **Scenarios:** invalid workflow body, successful normalisation, client-supplied `status`
- **Key assertions:** invalid body returns 400 and the handler is not reached; on success the downstream handler receives the normalised body through `res.locals.validatedBody` rather than `req.body`; a client-supplied `status` is rejected
- **Edge cases covered:** the middleware contract that validated output replaces raw input
- **Does not prove:** validation rules themselves (those belong to `validators/workflow.validator.test.ts`); only the transport-and-injection behaviour of the middleware

### 5.4 Models

#### `src/models/apiKey.model.test.ts`

- **Module tested:** `ApiKeyModel` schema
- **Tests:** 7, no `describe`
- **Type:** unit schema assertions, no database
- **Fakes/injection:** none; models are instantiated directly and validated in memory
- **Scenarios:** required fields, default status, status enum, tenant reference, index declaration, timestamps, nullable expiry/revocation
- **Key assertions:** `new ApiKeyModel({})` fails validation on `tenantId`, `keyHash`, `keyPrefix`; `status` defaults to active and accepts only active or revoked; `tenantId` is an `ObjectId` reference to `Tenant`; a unique index is declared on `keyHash`; timestamps are enabled; `expiresAt` and `revokedAt` default to `null`
- **Edge cases covered:** status enum rejection; nullable fields defaulting rather than being undefined
- **Does not prove:** that the unique index actually exists in a live deployment, or that duplicate hashes are rejected at insert time. Index declaration is read from schema metadata, not exercised against MongoDB

#### `src/models/models.test.ts`

- **Module tested:** `TenantModel`, `WorkflowModel`, `WorkflowExecutionModel`
- **Tests:** 28 across three `describe` blocks (Tenant, Workflow, WorkflowExecution)
- **Type:** unit schema assertions, no database
- **Fakes/injection:** none; documents are constructed and validated in memory using `validGraph` as the snapshot fixture
- **Scenarios:** required fields and defaults per schema; enum handling for execution status, execution compensation status, and per-node compensation status; presence, absence, and shape of nested compensation metadata; legacy records without compensation metadata; version lower bounds; timestamps; declared indexes
- **Key assertions:** required-field failures for each schema; `status`/`version` defaults and enum rejection; `version` below one rejected; `graphSnapshot` cannot be `null`; both legacy node results and nested compensation metadata validate; unsupported execution, execution-compensation, and per-node-compensation statuses each produce a validation error; `Date` compensation timestamps and absent optional fields both accepted; tenant-scoped query indexes declared
- **Edge cases covered:** backward compatibility with execution records written before compensation metadata existed; optional compensation fields omitted entirely versus explicitly `null`
- **Does not prove:** persistence semantics, migration behaviour, or index effectiveness. These are schema-shape assertions only — no document is ever saved

### 5.5 Routes

#### `src/routes/workflow.routes.test.ts`

- **Module tested:** `createWorkflowRouter` behind `tenantAuthMiddleware` and `errorHandler`
- **Tests:** 12, no `describe`
- **Type:** HTTP integration, in-process, no database
- **Fakes/injection:** a stub `TenantResolver` mapping `valid-test-key` and `other-test-key` to two distinct `tenantId`s, plus a hand-written workflow service that records every call (`createWorkflowCalls`, `listedTenantIds`, `graphUpdateCalls`, `deleteWorkflowCalls`) and returns `null` for cross-tenant IDs
- **Scenarios:** missing and unresolvable API key; create; list; update graph; delete; invalid IDs; cross-tenant access; blank name; client-supplied `tenantId`/`status`/`version`; malformed JSON
- **Key assertions:** creation and deletion use the authenticated tenant, never the request body; a supplied `tenantId` query parameter is ignored and listing still uses the trusted tenant; invalid IDs and other-tenant workflows return not found rather than leaking existence; authentication is required before any mutation; malformed JSON returns an error without exposing parser internals
- **Edge cases covered:** tenant isolation on read, write, and delete paths; body-field spoofing; parser-detail leakage
- **Does not prove:** real persistence, real API-key lookup, or status-code behaviour of the concrete workflow service — the service object is a stub and Mongoose is never involved

#### `src/routes/execution.routes.test.ts`

- **Module tested:** `createExecutionRouter`, mounted at both `/api/workflows` and `/api/executions`
- **Tests:** 17, no `describe`
- **Type:** HTTP integration, in-process, no database
- **Fakes/injection:** the same two-tenant `TenantResolver` stub, plus a stateful fake execution service driven by module-level `mode` (`normal` / `execution-error` / `not-found`) and `historyRecords`, with `resetState()` between tests. Received arguments (`tenantId`, `workflowId`, `executionId`, `limit`, `cursor`, `input`) are captured in module-level variables for assertion.
- **Scenarios:** missing and invalid API key; execute with input forwarding; queue unavailable; fetch execution by ID; unavailable execution; history pagination parameters; missing workflow; malformed workflow and execution IDs; client-supplied `tenantId`; unexpected errors; all Saga statuses; legacy records without compensation metadata; mixed Saga and legacy history; cross-tenant detail and history access
- **Key assertions:** execution runs under the authenticated tenant and forwards the request input unchanged; an unavailable queue returns 503; pagination `limit` and `cursor` reach the service intact; malformed IDs return 400; a client-supplied `tenantId` is not trusted; internal error details are not exposed; original task errors are separated from compensation errors in the response; another tenant's execution and history are not returned
- **Edge cases covered:** Saga and legacy record shapes coexisting in one history response; cross-tenant isolation on both detail and list endpoints; error-code surface for every defined execution status
- **Does not prove:** the real execution service, actual saga execution, or database queries. All execution semantics here are the fake's, so the suite verifies route wiring and tenant scoping, not runtime behaviour

### 5.6 Services

#### `src/services/apiKeyCrypto.test.ts`

- **Module tested:** `generateApiKey`, `hashApiKey`
- **Tests:** 4, no `describe`
- **Type:** pure unit, no fakes needed
- **Scenarios:** key generation shape, uniqueness, hash determinism, plaintext/hash separation
- **Key assertions:** plaintext key and prefix both start with `zaal_`; the plaintext is longer than the prefix; two generated keys differ in plaintext and hash; `hashApiKey` returns the same value for the same input; the hash is not the plaintext and matches `/^[a-f0-9]{64}$/`
- **Edge cases covered:** accidental plaintext storage is caught explicitly by comparing hash against plaintext
- **Does not prove:** entropy quality of the source, timing-safe comparison, or rotation. The hex-shape assertion pins the digest to a 32-byte hex encoding but does not assert which algorithm produced it

#### `src/services/apiKeyManagement.service.test.ts`

- **Module tested:** `createApiKeyManagementService`
- **Tests:** 7, no `describe`
- **Type:** unit with injected fakes
- **Fakes/injection:** `ApiKeyManagementDependencies` implemented over in-memory arrays — `findActiveTenant` gated by a `tenantIsActive` flag and tenant equality, `createKeyRecord` recording stored records, `revokeKeyRecord` rejecting any tenant that is not the fixture tenant
- **Scenarios:** creation, hash-to-key correspondence, inactive tenant, expiry in the past, expiry in the future, revocation, invalid key ID
- **Key assertions:** the stored record contains only the hash and prefix, never the plaintext; the stored hash is the hash of the key returned to the caller (`hashApiKey(returned) === stored.keyHash`); creation for an inactive tenant is rejected; past expiry rejected, future expiry accepted; revocation goes through the tenant-scoped dependency; a malformed key ID is rejected before any dependency call
- **Edge cases covered:** inactive tenant and expiry boundary are the two authorisation-adjacent paths; invalid ID short-circuits
- **Does not prove:** that the tenant scope is enforced in the real query, or that a plaintext key never reaches MongoDB. Scope is enforced by the fake's own `equals` check, mirroring the interface contract rather than testing it

#### `src/services/tenantresolver.test.ts`

- **Module tested:** `createTenantResolver`
- **Tests:** 8, no `describe`
- **Type:** unit with injected fakes
- **Fakes/injection:** `TenantResolverDependencies` over an in-memory key and tenant, both overridable per test (`key`, `tenant`, or `null` for absent); `findApiKeyByHash` records the hash it was called with so the test can assert what was looked up
- **Scenarios:** valid active key, unknown key, revoked key, key carrying a revocation timestamp, expired key, missing tenant, inactive tenant, empty key
- **Key assertions:** a valid key resolves to the fixture tenant; `assert.equal(getLookedUpHash(), generated.keyHash)` proves lookups use the hash, not the plaintext; unknown key returns `null` while the rejection cases throw; revoked, expired, missing-tenant, and inactive-tenant cases each fail; an empty API key is rejected
- **Edge cases covered:** status field versus revocation timestamp as two independent revocation signals; expiry evaluated against the clock
- **Does not prove:** index usage on `keyHash`, the uniqueness guarantee at insert time, or cache behaviour. Time-dependent cases use fixture timestamps rather than a mocked clock, so a future date is simply chosen to be in the past relative to run time

#### `src/services/workflow.service.test.ts`

- **Module tested:** `createWorkflowService`
- **Tests:** 14, no `describe`
- **Type:** unit with injected fakes
- **Fakes/injection:** `WorkflowServiceDependencies` implemented over in-memory arrays: `createWorkflowRecord`, `findWorkflowRecordsByTenant`, `updateWorkflowGraph`, `deleteWorkflow`. Each fake also records its arguments (`listCalls`, `graphUpdates`, `workflowDeletes`) so tenant scoping can be asserted.
- **Scenarios:** creation, default status and version, description trimming and omission, blank name, persistence errors, tenant-scoped listing, graph update, malformed ID, invalid graph, deletion, not-found on update and delete, malformed ID on delete
- **Key assertions:** created workflows always receive `status: "draft"` and `version: 1` regardless of input; name and description are trimmed; description is omitted rather than stored as `undefined`; listing passes only the supplied tenant to the dependency; graph updates and deletes carry both workflow ID and tenant; malformed IDs and invalid graphs are rejected **without** calling the dependency; `null` from the dependency becomes a not-found result
- **Edge cases covered:** the "no dependency call on rejection" assertions, which catch validation running after persistence
- **Does not prove:** Mongoose query behaviour, index use, or real not-found semantics — those are the fake's return values

#### `src/services/execution.runtime.test.ts`

- **Module tested:** `executeWorkflowGraph`
- **Tests:** 20 in one `describe("executeWorkflowGraph")`
- **Type:** unit, real runtime with in-memory action registries
- **Fakes/injection:** `createGraph()` builds a trigger → condition → two-task graph with `true`/`false` branch edges. Each test supplies its own `ActionRegistry` object literal (`taskActions`, `compensationActions`) with inline handlers, so no real HTTP or transform implementation is loaded.
- **Scenarios:** true and false branch routing; missing condition input; invalid comparison operands; graph immutability; unregistered action identifier; documented action field mapping; unsupported action; supported action with no handler; invalid action-specific input; unapproved compensation field; unknown compensation action; invalid compensation config; omitted compensation config; JSON-compatible output persistence; invalid JSON output; non-finite numbers, functions, `undefined`, non-plain objects; thrown handler exception; handler exceeding `timeoutMs`; non-positive timeout
- **Key assertions:** branch selection follows `sourceHandle`; the original graph object is not mutated; error codes are specific rather than generic — `UNSUPPORTED_COMPENSATION_CONFIG`, `COMPENSATION_ACTION_NOT_REGISTERED`, `ACTION_TIMEOUT`; invalid config is rejected **before** any handler is invoked; a successful side effect is not discarded when its output fails the JSON contract; a thrown handler becomes a structured failure rather than an unhandled rejection
- **Edge cases covered:** the timeout case and the pre-dispatch validation cases are the security- and correctness-relevant ones; the non-plain-output case guards JSON serialisation of action results
- **Does not prove:** isolation of arbitrary user scripts (handlers are trusted test functions), cancellation of a running handler after timeout, or exactly-once execution. The timeout test establishes that the runtime stops waiting and reports `ACTION_TIMEOUT`; it does not establish that the handler stopped

#### `src/services/execution.service.test.ts`

- **Module tested:** `createExecutionService`, plus `buildExecutionUpdateFilter` and `ExecutionServiceError`
- **Tests:** 25, no `describe`
- **Type:** unit with injected persistence, real runtime
- **Fakes/injection:** `makeDependencies(overrides)` supplies `findWorkflow`, `createExecution`, `updateExecution`, `findExecution`, `findHistory` as in-memory implementations. `updateExecution` receives expected status and expected results and is where the optimistic-concurrency contract is simulated. The workflow graph execution itself is the **real** `executeWorkflowGraph`, and each test builds a real `ActionRegistry` with inline task and compensation handlers.
- **Scenarios:** success path, invalid graph, out-of-scope workflow, running-state persistence failure, terminal persistence failure, tenant-scoped lookup, malformed IDs and limits, history pagination and cursor handling, fractional limits, no-next-cursor, competing checkpoint guard, non-JSON task output, handler success followed by terminal persistence failure, compensation after later failure, reverse compensation order, separation of task and compensation errors, compensation of a side effect whose output breaks the JSON contract, multiple compensation failures, condition-skipped tasks excluded from compensation, thrown compensation handler, missing pre-handler checkpoint, ambiguous compensation outcome, compensation on timeout, late handler settlement after a recorded timeout
- **Key assertions:** tenant scope is applied on every read and write; a failed running-state persist aborts before execution; a terminal persist failure after a successful handler is reported rather than swallowed; compensation runs in reverse completion order; skipped branch tasks are never compensated; task errors and compensation errors are stored separately and never replace each other; the checkpoint guard is expressed as an exact prior `nodeResults` snapshot, and the fake uses `isDeepStrictEqual` against `buildExecutionUpdateFilter` output to prove a stale writer cannot win; a timeout records `ACTION_TIMEOUT` and a later handler settlement does not overwrite it
- **Edge cases covered:** concurrent checkpoints, ambiguous compensation outcome when the terminal checkpoint fails, and late settlement are the three hardest; the last one is the regression this suite was extended for
- **Does not prove:** real MongoDB conditional-update semantics. The filter is constructed and asserted in isolation, so atomicity relies on the production query path honouring the same filter — that path is not executed here. No transaction, rollback, or retry behaviour is tested.

#### `src/services/executionGraphs.fixture.test.ts`

- **Module tested:** `validateWorkflowGraph` and `executeWorkflowGraph`, exercised through shared fixtures
- **Tests:** 3 declarations that execute as 7 cases — the loop over `executionGraphCases()` yields three fixtures (linear, condition-true, condition-false), each getting a validation case and an execution case, plus one standalone case
- **Type:** unit, contract check on fixtures
- **Fakes/injection:** uses the fixtures from `executionGraphs.fixture` and its `linearGraphCase()` factory; no registry or database involvement beyond what the graph contains
- **Scenarios:** each fixture validates cleanly; each fixture executes to `completed` with the expected `expectedNodeIds` sequence; `linearGraphCase()` returns independent objects per call
- **Key assertions:** `validateWorkflowGraph(graph)` returns `[]` for every fixture; `result.status === "completed"` and the resulting `nodeResults` `nodeId` order deep-equals `expectedNodeIds`; mutating one factory result does not affect another
- **Edge cases covered:** fixture independence, which protects tests that mutate graphs in place
- **Does not prove:** broad graph-shape coverage. Three fixtures is a smoke test that the shared fixtures and the runtime agree, not a substitute for the dedicated validator suite

### 5.7 Validators

#### `src/validators/workflow-graph.validator.test.ts`

- **Module tested:** `validateWorkflowGraph`
- **Tests:** 27, no `describe`
- **Type:** unit, no fakes
- **Fakes/injection:** none. Two sources of input: an inline `validGraph` literal, and JSON fixtures loaded from `docs/fixtures` through `readFileSync(resolve(__dirname, "../../../docs/fixtures", name))`, with a BOM strip before `JSON.parse`. This makes the suite depend on the repository layout, not just on source code.
- **Scenarios:** valid graph; non-object input; missing node and edge arrays; unsupported node types; node/data type mismatch; empty label; label over 120 characters; duplicate node IDs; edge with missing target; invalid condition branch handle; directed cycle; non-finite positions; every JSON fixture (valid condition graph, invalid cycle, invalid edge endpoint, duplicate IDs, malformed position, missing condition branch, missing trigger, multiple triggers, invalid version); fixtures all parse as JSON objects; unsupported version; no trigger; multiple triggers; condition missing its true branch; condition missing its false branch
- **Key assertions:** each invalid case is asserted to return at least one error rather than throw; the valid fixture returns an empty error array; every fixture file is proven parseable so a malformed fixture cannot masquerade as a passing rejection
- **Edge cases covered:** cycle detection, duplicate IDs, trigger cardinality, branch-handle validity, non-finite coordinates, and version rejection — the validation rules that would otherwise reach the runtime
- **Does not prove:** that the frontend can produce a graph the validator accepts beyond the single valid fixture, or performance characteristics. Fixture tests assert rejection, not the specific error message for most cases

#### `src/validators/workflow.validator.test.ts`

- **Module tested:** `validateCreateWorkflow`, `validateUpdateWorkflow`
- **Tests:** 18 across two `describe` blocks
- **Type:** unit, no fakes
- **Fakes/injection:** none; bodies are plain objects and graphs come from a local `WorkflowGraph` literal
- **Scenarios (create):** client-supplied status; valid body with trimming; missing name; invalid status; client-supplied `tenantId`; client-supplied `version`; non-object body
- **Scenarios (update):** trimming; description-only update; empty update; status change; `tenantId` and `version`; unknown fields; invalid name; invalid description; missing graph; invalid graph; missing and unsupported condition configuration
- **Key assertions:** every attempt to set server-owned fields (`tenantId`, `version`, `status`) from the client is rejected on both create and update; editable fields are trimmed; an update containing only a description is valid while a completely empty update is not; unknown fields are rejected instead of ignored; graph validity is enforced at the validator layer
- **Edge cases covered:** mass-assignment of server-owned fields is the security-relevant case; the description-only update guards against over-strict "all fields required" validation
- **Does not prove:** route-level behaviour, persistence, or that the trimmed values are what reach the database. It also does not re-test graph rules; it relies on the graph validator, which has its own suite

## 6. Coverage summary and visible gaps

All 17 files are unit tests over injected fakes or in-process HTTP tests against real Express routers. None opens a database connection: the only file that mentions a connection string asserts against `mongodb://example.invalid/test` with `mongoose.connect` mocked, and expects the connection to fail.

Areas that are covered:

- Graph validation rules, including cycle, trigger-count, branch-handle, ID-uniqueness, position, label, and version rules
- Request-body validation for create and update, including rejection of client-supplied server-owned fields
- Tenant isolation at the middleware and route layers, on read, write, and delete paths
- API-key generation, hashing, lookup, expiry, and revocation
- Runtime branch routing, action dispatch, JSON output contract, and timeout reporting
- Saga compensation: ordering, eligibility, error separation, and checkpoint guarding
- Schema shape and backward compatibility for execution records with and without compensation metadata

Visible gaps:

- No coverage tooling is configured and no coverage script exists, so no coverage percentage can be reported.
- Persistence is always faked. Real Mongoose queries, index enforcement, unique constraints, and the conditional-update filter are not executed against MongoDB.
- No Change Stream behaviour is tested, and no Change Stream code exists under `backend/src`.
- `npm test` does not type-check; type errors surface only from a separate `tsc` run.
- The graph validator suite loads fixtures from `docs/fixtures`, so those tests depend on repository layout and would fail if the directory moves.
- Compensation-timeout interaction is tested at the service level, but a handler that hangs indefinitely is only proven to stop being awaited, not to be cancelled.

## 7. Running the tests locally

```powershell
cd backend
npm install      # first time only
npm test
```

No environment variables and no database are required. `src/config/database.test.ts` mocks the connection, and every other file injects its dependencies.

Do not point `MONGODB_URI` at the shared Atlas cluster when running tests. The suite is designed to run without a live database, and the project rule for documentation work is that the shared cluster is not written to.

Useful variants:

```powershell
npx tsx --test src/validators/workflow-graph.validator.test.ts   # one file
npx tsc --noEmit                                                 # type-check, not part of npm test
```

Do not run `npm run build` while preparing documentation; it regenerates `backend/dist/**/*.test.js`. That directory is git-ignored, but the files add noise when searching for test files.
