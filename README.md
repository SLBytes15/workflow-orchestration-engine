# Multi-Tenant Distributed Workflow & Saga Orchestration Engine

# Workflow & Saga Orchestration Engine

Zaalima internship project: a workflow canvas and API for defining, validating,
persisting, and executing tenant-owned workflow graphs.

## Project overview

The project addresses the need to represent a multi-step process as a directed
graph, validate that graph, and record workflow runs and their outcomes. The
repository contains a React frontend and a TypeScript/Express backend backed by
MongoDB.

The implementation is an evolving development project, not a claim of a
production-ready distributed platform. In particular, execution currently
runs in the API request path; this repository does not establish a queue or
worker architecture.

## Implemented capabilities

- **Workflow management:** create workflows with a name, optional description,
  and graph; list and delete workflows; and update workflow fields through the
  backend API. New workflows are created with `draft` status and version `1`.
- **Graph validation:** validate version-1 graphs with `trigger`, `task`, and
  `condition` nodes and edges. The backend validates graph structure and
  condition configuration on creation and graph replacement.
- **Workflow canvas:** prepare and inspect a graph in the React interface.
  Saved workflows are loaded from the backend when an API key is configured;
  sample entries in the interface are demonstration data, not persisted
  workflows.
- **Execution records:** start a saved workflow, retain a graph snapshot and
  workflow version for the run, and retrieve tenant-scoped execution details
  and paginated history.
- **Saga compensation path:** the runtime supports registered compensation
  handlers for eligible successful tasks. It records compensation checkpoints
  and distinguishes `compensated` from `compensation_failed`; this is not a
  guarantee that every external side effect can be undone.

## Architecture

```text
React + TypeScript + Vite
           |
           | HTTP / JSON, X-API-Key
           v
Express API
  |-- authentication and request validation
  |-- workflow and execution services
  |-- graph execution runtime
           |
           v
MongoDB via Mongoose
```

The frontend calls the backend over HTTP. The Express application resolves
tenant API keys and routes workflow and execution requests to services. Those
services read and write tenant-owned workflow and execution records through
Mongoose. Workflow execution is invoked directly by the execution request
handler; a `queued` record is persisted before the service transitions it to
`running`, executes the graph, and persists the terminal result.

## Technology stack

| Area | Verified technologies |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, `@xyflow/react` |
| Backend | Node.js, TypeScript, Express 5 |
| Persistence | MongoDB with Mongoose 9 |
| Development and checks | npm, `tsx`, TypeScript compiler, Oxlint |

Dependency versions are declared in `frontend/package.json` and
`backend/package.json`. There is no root `package.json`; install and run each
application from its own directory.

## Repository structure

```text
.
|-- README.md
|-- CONTRIBUTING.md
|-- workflow-canvas-contract.md
|-- docs/
|   |-- architecture.md
|   |-- requirements.md
|   |-- workflow-api-auth-contract.md
|   |-- workflow-graph-contract.md
|   `-- backend/
|-- backend/
|   |-- .env.example
|   |-- package.json
|   |-- scripts/
|   `-- src/
|       |-- config/       # Database connection setup
|       |-- middleware/   # Authentication, validation, rate limiting, errors
|       |-- models/       # Tenant, API-key, workflow, execution models
|       |-- routes/       # Workflow and execution HTTP routes
|       |-- services/     # Workflow, execution, runtime, key services
|       |-- types/
|       `-- validators/   # Workflow and graph validation
`-- frontend/
    |-- .env.example
    |-- package.json
    |-- public/
    |-- tests/
    `-- src/
        |-- api/           # Workflow and execution HTTP clients
        |-- components/
        |-- pages/
        |-- graphValidation.ts
        `-- workflowState.ts
```

## Prerequisites

- Node.js and npm.
- A MongoDB instance and connection string that you are authorized to use for
  local development. Do not use a shared database unless your team explicitly
  authorizes it.

The backend requires `MONGODB_URI` and will not start if it is missing or the
database connection fails. No live database connection is required to read
this documentation or inspect the source.

## Local development setup

### Backend

From a terminal:

```powershell
cd backend
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

If `.env` already exists, this command leaves it unchanged.

Edit `backend/.env` and set `MONGODB_URI` to your authorized development
database. The example URI contains placeholders; it is not a usable
credential. Keep `.env` local and do not commit it. `PORT` is optional and
defaults to `3000`.

Start the backend from `backend/`:

```powershell
npm run dev
```

### Frontend

In a second terminal:

```powershell
cd frontend
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

If `.env` already exists, this command leaves it unchanged.

Set `VITE_API_BASE_URL` to the backend URL if it differs from its default
(`http://localhost:3000`). Configure `VITE_API_KEY` with an approved local
development key. Vite variables are available to browser code: use only a
development key here, never a production secret.

Start the frontend from `frontend/`:

```powershell
npm run dev
```

Open the local URL printed by Vite. The frontend is configured to call the
backend at `http://localhost:3000` by default.

## Environment variables

These names are present in the checked-in `.env.example` files or are read by
the application:

| Variable | Application | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | Backend | MongoDB connection string; required at startup |
| `PORT` | Backend | HTTP port; defaults to `3000` |
| `VITE_API_BASE_URL` | Frontend | Backend base URL; defaults to `http://localhost:3000` |
| `VITE_API_KEY` | Frontend | Tenant API key sent by the browser as `X-API-Key` |

Do not put real credentials, API keys, or connection strings in this README or
other tracked documentation. The root ignore rules exclude `.env` files and
allow `.env.example` files.

## Development, build, and test commands

Run commands in the application directory shown in the first column.

| Directory | Command | Purpose |
| --- | --- | --- |
| `backend/` | `npm run dev` | Run the backend with `tsx watch` |
| `backend/` | `npm test` | Run backend tests with Node's test runner through `tsx` |
| `backend/` | `npm run build` | Compile TypeScript to `backend/dist/` |
| `backend/` | `npm start` | Run the compiled backend from `dist/` |
| `frontend/` | `npm run dev` | Start the Vite development server |
| `frontend/` | `npm run build` | Type-check and create the Vite production build |
| `frontend/` | `npm run lint` | Run Oxlint |
| `frontend/` | `npm run preview` | Preview a production build locally |

There is no root-level script. The frontend package currently defines no
`test` script; frontend test files are present under `frontend/tests/`, but
their supported runner/command needs verification before being documented as
an executable test workflow.

## Workflow and execution journeys

1. **Prepare a graph.** Use the frontend's Node Preview/canvas to prepare a
   graph. The graph contract uses version `1` and `trigger`, `task`, and
   `condition` nodes.
2. **Create and save a workflow.** The create form requires a graph and a
   tenant API key. The backend validates the request and graph, assigns the
   authenticated tenant, and creates a `draft` workflow at version `1`.
   `GET /api/workflows` lists the authenticated tenant's workflows.
3. **Update or delete a saved workflow.** The backend exposes
   `PATCH /api/workflows/:workflowId` for editable workflow fields,
   `PUT /api/workflows/:workflowId/graph` for graph replacement, and
   `DELETE /api/workflows/:workflowId`. Graph replacement increments the
   workflow version. Saving edits to an existing workflow from the frontend
   is **Needs verification**; the inspected workflow page does not call the
   update API.
4. **Execute a saved workflow.** The frontend sends
   `POST /api/workflows/:workflowId/executions` with an `input` JSON object and
   the tenant key. This request waits for the execution service to return its
   persisted result; it is not a background-job submission.
5. **Review a run.** The execution page retrieves workflow history and
   individual execution details. History supports a limit and cursor, and the
   page can load additional results.

There is no implemented workflow activation operation in the inspected
workflow routes: creation sets `draft`, and the general update validator
rejects status changes. The model's `active` status value alone does not
establish an activation journey.

## Tenant isolation and API-key handling

- Workflow and execution routes require the `X-API-Key` header. Missing,
  invalid, revoked, expired, or inactive-tenant keys are rejected by the
  resolver and authentication middleware.
- The resolver hashes the supplied key with SHA-256 and looks up the stored
  hash. The API-key model stores the hash and key metadata, excludes the hash
  from normal query selection, and does not persist the plaintext key.
- Workflow and execution service queries include the authenticated tenant ID.
  A client-supplied tenant ID is not the source of tenant authorization.
- The frontend reads `VITE_API_KEY` in browser code. It is suitable only for
  an approved development setup, not for protecting production credentials.

These source-level controls do not by themselves certify production security
or every possible tenant-isolation scenario. See
[`docs/workflow-api-auth-contract.md`](./docs/workflow-api-auth-contract.md)
for the contract and remaining decisions.

## Execution lifecycle, compensation, and event triggers

The execution service persists an execution record with a graph snapshot and
workflow version, moves it from `queued` to `running`, invokes
`executeWorkflowGraph()` in the request path, and persists the result. The
execution model supports `queued`, `running`, `completed`, `failed`,
`compensating`, `compensated`, and `compensation_failed` statuses.

When a task fails, the runtime can compensate previously completed tasks that
have compensation configuration, in reverse completion order, using a
registered compensation handler. It persists checkpoints around compensation.
Compensation may itself fail; persistence errors can leave the outcome
unconfirmed, and the service does not automatically replay compensation in
that case. This is not an at-least-once or exactly-once guarantee.

The default execution service does not register concrete task or compensation
handlers. External task integrations and the full runtime behavior with
production handlers are **Needs verification**. The graph's trigger node is
the start of graph traversal; the inspected implementation does not establish
an external event source or MongoDB Change Streams integration. Event
delivery, retry policies, and worker-based execution are not documented as
implemented capabilities.

## Testing evidence and limitations

The backend has unit and service/route tests under `backend/src/`. The
frontend has test files under `frontend/tests/`, but its package does not
declare a test command. Test results are not implied by the commands above.

[`backend/WORKFLOW_VERIFICATION_REPORT.md`](./backend/WORKFLOW_VERIFICATION_REPORT.md)
records a verification run dated 26 October 2026, including backend tests,
builds, lint, and limited manual execution checks. Those are historical
results, were not rerun for this README update, and do not prove comprehensive
tenant isolation, external task integration, or production readiness. The
report recorded cleanup of its temporary test tenant and API key as pending
as of 26 October 2026; the current cleanup status has not been verified.

The graph-validation benchmark is a single-process micro-benchmark, not a
load test or evidence of concurrent capacity. See
[`docs/backend/graph-validation-benchmark.md`](./docs/backend/graph-validation-benchmark.md)
for its scope and documented limitations. Browser end-to-end testing and
live-database integration behavior are **Needs verification**.

## Known gaps and future work

The following are not established as complete by the inspected implementation:

- Workflow activation and status transitions through the API.
- A durable queue, separate workers, distributed execution, or WebSocket
  updates.
- External event sources, Change Streams, and event-trigger delivery
  guarantees.
- A retry policy or automatic compensation replay.
- Concrete external task/compensation integrations in the default service.
- Saving edits to an existing workflow through the frontend.
- Browser end-to-end coverage and comprehensive live-database verification.

These are verification or implementation gaps, not current feature claims.
The source and documentation are evolving; check the relevant contract before
relying on a future behavior.

## Contributing

The team branch, review, and pull-request workflow is described in
[`CONTRIBUTING.md`](./CONTRIBUTING.md). Never commit `.env` files, API keys,
database credentials, or other secrets.
