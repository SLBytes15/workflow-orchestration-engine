# Multi-Tenant Distributed Workflow & Saga Orchestration Engine

A multi-tenant workflow and Saga orchestration engine with an interactive React visual canvas, real-time WebSocket execution monitoring, durable MongoDB-backed idempotency, node-level execution timeline analytics, and compensation mechanics.

---

## 1. Project Overview

The Workflow Orchestration Engine enables multi-tenant teams to define, validate, persist, execute, and monitor multi-step distributed workflows represented as directed acyclic graphs (DAGs). It combines:
- A modern visual graph canvas built on React 19 and `@xyflow/react`.
- A resilient backend built on Node.js, TypeScript, and Express 5.
- Durable persistence and concurrency control backed by MongoDB and Mongoose 9.
- Live execution status streaming via authenticated WebSockets.
- Node-level execution timeline and performance observability.
- Resilient idempotency with fencing tokens to guarantee safe retries across distributed instances.

---

## 2. Key Features

- **Multi-Tenant Isolation**: Strict logical data isolation enforced at the database query level using SHA-256 hashed API keys. Client-supplied tenant IDs are rejected.
- **Visual Workflow Studio**: Interactive graph editor supporting `trigger`, `task`, and `condition` nodes with live validation and drag-and-drop.
- **Workflow Lifecycle Management**: Full draft, active, paused, and resumed workflow lifecycle states with versioned graph updates (`PUT /graph`).
- **Enterprise Workflow Catalog**: Searchable workflow directory with card and table views, status filters, sorting, and duplicate actions.
- **Real-Time Execution Dashboard**: Live execution monitoring over WebSockets with metric cards, status filters, date range filters, and search.
- **Enterprise Analytics & System Health**: Dedicated observability dashboard featuring 7-status distribution breakdowns, terminal outcome ratios, and execution duration analytics without speculative trend interpolation.
- **Execution Timeline & Node Duration Insights**: Node-level duration calculation, visual status badges, and chronological execution progress.
- **Execution Details Drawer**: Deep inspection of execution snapshots, node outputs, errors, and compensation metadata.
- **Saga Compensation Runtime**: Reverse-order compensation of completed tasks upon workflow failure, separating original task errors from compensation errors.
- **Durable MongoDB Idempotency**: Atomic key reservation (`reserveKey`), TTL expiration, payload hashing, and fencing tokens (`reservationToken`) preventing zombie overwrites or stale cleanup.
- **Event-Driven Change Stream Watcher**: MongoDB Change Stream watcher dispatching matching insert events to active workflows.
- **Forward Checkpointing Policy**: Configurable `graph.executionPolicy.enableForwardCheckpoints` persisting intermediate progress.

---

## 3. Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 19, TypeScript 5.8, Vite 8, `@xyflow/react` 12, Lucide React |
| **Backend** | Node.js 20+, TypeScript 5.8, Express 5, `ws` (WebSockets) |
| **Database** | MongoDB 6.0+ (Replica Set required for Change Streams), Mongoose 9 |
| **Tooling & QA** | Node Test Runner via `tsx`, Oxlint, TypeScript Compiler (`tsc`) |

---

## 4. Architecture

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │                           Browser Frontend                             │
 │   React 19 Canvas  │  Execution Dashboard  │  Timeline & Drawer UI     │
 └───────────────────────┬───────────────────────────────┬────────────────┘
                         │                               │
             HTTP / REST │ (X-API-Key)     WebSockets    │ (/ws/executions?ticket=)
                         ▼                               ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                          Express 5 Backend                             │
 │  ┌──────────────────────────────────────────────────────────────────┐  │
 │  │ API Key Resolver & Tenant Context Middleware                     │  │
 │  └──────────────────────────────┬───────────────────────────────────┘  │
 │                                 ▼                                      │
 │  ┌─────────────────────────┐  ┌─────────────────────────────────────┐  │
 │  │ Workflow Service & Graph│  │ Execution Service & Runtime         │  │
 │  │ Validator               │  │ - Graph Traversal & Sagas           │  │
 │  └─────────────────────────┘  │ - Forward Checkpoint Policy         │  │
 │                               │ - Idempotency & Fencing Tokens      │  │
 │                               └──────────────────┬──────────────────┘  │
 │  ┌────────────────────────┐                      │                     │
 │  │ Change Stream Watcher  │                      ▼                     │
 │  └───────────▲────────────┘   ┌─────────────────────────────────────┐  │
 │              │                │ WebSocket Event Hub (ws)            │  │
 │              │                └─────────────────────────────────────┘  │
 └──────────────┼───────────────────────────────────┼─────────────────────┘
                │ MongoDB Change Streams            │
                ▼                                   ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                         MongoDB Database                               │
 │   tenants │ apikeys │ workflows │ workflowexecutions │ idempotencyrecords │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Repository Structure

```text
.
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── app.ts                         # Express app configuration & middleware
│       ├── index.ts                       # Server startup, WebSocket attachment, shutdown
│       ├── config/database.ts             # MongoDB Mongoose connection
│       ├── middleware/                    # Tenant auth, rate limiting, error handling
│       ├── models/                        # Tenant, ApiKey, Workflow, WorkflowExecution, IdempotencyRecord
│       ├── routes/                        # Workflow, execution, WebSocket ticket routes
│       ├── services/                      # Execution runtime, idempotency, recovery, WebSocket hub
│       └── validators/                    # Workflow graph & execution policy validators
├── frontend/
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tests/                             # Automated frontend test suites
│   └── src/
│       ├── App.tsx                        # Main application layout and routes
│       ├── api/                           # Workflow and execution API clients
│       ├── pages/                         # DashboardPage, WorkflowsPage, ExecutionsPage, AnalyticsPage, SettingsPage
│       └── executionHelpers.ts            # Timeline, duration, formatters, and analytics helpers
└── docs/                                  # API contracts, architecture specifications, handovers
```

---

## 6. Installation Prerequisites

- **Node.js**: Version 20.x or higher.
- **npm**: Version 10.x or higher.
- **MongoDB**: Version 6.0 or higher.
  - *Note:* MongoDB Change Streams require a **Replica Set** (local single-node replica set or MongoDB Atlas). Standard standalone MongoDB instances will reject Change Streams.

---

## 7. Environment Setup

### Backend (`backend/.env`)
Copy `.env.example` to `.env` in the `backend/` directory:
```bash
cp backend/.env.example backend/.env
```

| Variable | Required | Description | Example |
|---|---|---|---|
| `MONGODB_URI` | **Yes** | Connection string to MongoDB replica set / Atlas | `mongodb://localhost:27017/workflow_engine?replicaSet=rs0` |
| `PORT` | No | Server HTTP listening port (defaults to `3000`) | `3000` |

### Frontend (`frontend/.env`)
Copy `.env.example` to `.env` in the `frontend/` directory:
```bash
cp frontend/.env.example frontend/.env
```

| Variable | Required | Description | Example |
|---|---|---|---|
| `VITE_API_BASE_URL` | No | Backend API base URL (defaults to `http://localhost:3000`) | `http://localhost:3000` |
| `VITE_API_KEY` | No | Tenant API key used by browser during development | `wf_live_testkey123...` |

---

## 8. Database Configuration & Indexes

The engine requires MongoDB with Mongoose. Key indexes declared across models:
- **`Tenant`**: Unique index on `slug`.
- **`ApiKey`**: Unique index on `keyHash`. Scoped index on `(tenantId, status)`.
- **`Workflow`**: Scoped index on `(tenantId, name)`.
- **`WorkflowExecution`**: Scoped indexes on `(tenantId, workflowId, createdAt)`, `(tenantId, status, createdAt)`.
- **`IdempotencyRecord`**:
  - Unique compound index on `(tenantId, workflowId, key)`.
  - TTL expiration index on `expiresAt` with `expireAfterSeconds: 0`.

---

## 9. Development Startup Commands

### Start Backend (with automatic reload):
```bash
cd backend
npm install
npm run dev
```

### Start Frontend (Vite dev server):
```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## 10. Testing Commands

The project features comprehensive automated test suites across backend and frontend:

| Suite | Command | Details |
|---|---|---|
| **Backend Tests** | `cd backend && npm test` | 444 tests across 18 suites (Node test runner via `tsx`). |
| **Frontend Tests** | `cd frontend && ../backend/node_modules/.bin/tsx --test tests/**/*.test.ts` | 196 tests across 51 suites (Unit, state, UI, timeline, and analytics). |
| **Frontend Lint** | `cd frontend && npm run lint` | Oxlint fast linting across all frontend files. |

---

## 11. Production Build Commands

### Build Backend:
```bash
cd backend
npm run build
```
Compiles TypeScript into `backend/dist/`. Run in production with:
```bash
npm start
```

### Build Frontend:
```bash
cd frontend
npm run build
```
Type-checks with `tsc -b` and bundles production assets into `frontend/dist/`. Preview locally with:
```bash
npm run preview
```

---

## 12. API Overview

All routes except `/api/health` require the `X-API-Key` HTTP header.

### Workflows API (`/api/workflows`)
- `GET /api/workflows`: List all workflows for the authenticated tenant.
- `POST /api/workflows`: Create a new workflow (starts in `draft` status, version 1).
- `GET /api/workflows/:workflowId`: Retrieve a workflow by ID.
- `PATCH /api/workflows/:workflowId`: Update editable fields (`name`, `description`).
- `PUT /api/workflows/:workflowId/graph`: Replace graph definition (increments version).
- `DELETE /api/workflows/:workflowId`: Delete workflow.
- `POST /api/workflows/:workflowId/activate`: Transition workflow from `draft` to `active`.
- `POST /api/workflows/:workflowId/pause`: Transition workflow from `active` to `paused`.
- `POST /api/workflows/:workflowId/resume`: Transition workflow from `paused` to `active`.

### Executions API (`/api/workflows` & `/api/executions`)
- `POST /api/workflows/:workflowId/executions`: Start a workflow execution.
  - Supports optional `Idempotency-Key` header.
  - Accepts JSON payload: `{"input": { ... }}`.
- `GET /api/executions`: Global paginated execution history with cursor, status, date, and workflow filters.
- `GET /api/executions/summary`: Aggregated execution analytics (counts by status, success rate, failure rate, durations).
- `GET /api/executions/:executionId`: Retrieve complete execution record, node results, and compensation details.
- `GET /api/workflows/:workflowId/executions`: List execution history for a specific workflow.
- `POST /api/executions/ws-ticket`: Issue a single-use, 60-second WebSocket connection ticket.

---

## 13. WebSocket Real-Time Monitoring

- **Endpoint**: `ws://<host>:<port>/ws/executions?ticket=<ticket>`
- **Ticket Lifecycle**:
  1. Client sends `POST /api/executions/ws-ticket` with `X-API-Key`.
  2. Backend validates key, generates a cryptographically random UUID ticket bound to `tenantId`, and caches it for 60 seconds.
  3. Client connects to WebSocket endpoint passing `?ticket=<ticket>`.
  4. Backend consumes ticket (single-use), associates connection with tenant, and streams live updates.
- **Events**:
  - `execution:updated`: Emitted whenever a workflow execution transitions status or updates nodes. Scoped strictly to the owning tenant.

---

## 14. Idempotency & Recovery Architecture

- **Durable Key Reservation**: Keys are stored in MongoDB (`IdempotencyRecord`) with compound unique index `(tenantId, workflowId, key)`.
- **Fencing Tokens**: Every in-flight reservation generates a unique `reservationToken`. If Request A experiences a latency pause exceeding the grace period ($5\,\text{s}$) and Request B reclaims the key, Request B receives a new fencing token. When Request A resumes, its token is invalidated, preventing zombie writes or deletion of Request B's reservation.
- **On-Demand Reconciliation**: When clients retry with an existing key, the backend reconciles in-flight status against the actual `WorkflowExecution` document:
  - If execution completed $\to$ reconstructs and returns cached response.
  - If execution crashed before creation $\to$ atomically grants retry.
  - If execution is currently running $\to$ returns HTTP 409 `IDEMPOTENCY_KEY_IN_FLIGHT`.

---

## 15. Known Limitations & Architectural Scope

1. **Request-Path Execution**: Workflows currently execute within the Node.js API process. A separate message queue (e.g. RabbitMQ/Kafka) and decoupled worker fleet are recommended for long-running jobs.
2. **Change Streams Requirement**: Change Streams require a MongoDB Replica Set; standalone instances do not emit oplog events.
3. **Background Recovery Worker**: `IdempotencyRecoveryWorker` is implemented with an in-memory lock for single-instance sweeps. It is un-instantiated by default; production multi-instance deployments safely use on-demand reconciliation.
4. **No Automatic Forward Replay**: Forward checkpoints persist node progress to MongoDB, but automatic engine resumption from intermediate checkpoints is not auto-triggered.

---

## 16. Contributing & Guidelines

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for team branch workflows and coding standards. Never commit `.env` files or API secrets to version control.
