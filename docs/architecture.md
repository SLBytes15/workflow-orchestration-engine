# System Architecture

## 1. High-Level Architecture

Current execution path (synchronous):

React Client
    |
    | Authenticated HTTP request
    v
Express API -> API-key authentication -> server-derived tenant
    |
    v
Execution Service -> MongoDB: persist queued -> persist running
    |
    v
Workflow graph runtime (inline in request)
    |
    +---- Registered task handlers
    +---- Saga compensation checkpoints, when applicable
    |
    v
Persist checkpoints/terminal result -> MongoDB -> HTTP response / REST history and detail

Future components (not implemented):

    +---- Worker / queue
    +---- Retry / DLQ
    +---- Durable execution events / multi-instance pub-sub


## 2. Major Components

### Frontend
Responsible for workflow creation, visual DAG editing,
workflow status and monitoring interfaces.

### API Server
Responsible for HTTP APIs, tenant context,
validation and authentication-related middleware.

### Workflow Engine
Responsible for executing workflow nodes and
tracking workflow state.

### Saga Coordinator
Responsible for compensation when downstream
workflow operations fail.

### MongoDB
Stores tenant-scoped application and workflow data.

### Real-Time Layer
**Approved design, not implemented:** The MVP adds best-effort WebSocket
execution lifecycle notifications; REST remains the source of truth. See
[WebSocket Execution Updates](./websocket-execution-updates.md) for the
approved ticket/event contract and current implementation status.

## 3. Architecture Decisions

The WebSocket MVP contract and synchronous Week 3 execution decision are
approved. Retry execution, worker/queue architecture, and several production
authentication policies remain outside this implemented slice.

## 4. Open Technical Decisions

- Live-database verification of tenant isolation and guarantees beyond current REST route scoping
- Queue/execution architecture
- Worker architecture
- Production API-key lifecycle and operational policy
- Retry persistence, idempotency, and DLQ policy

### Tenant Request Context and Authorization

Workflow and execution REST routes require `x-api-key`. The database-backed
tenant resolver hashes the key for lookup, rejects inactive, revoked, or
expired keys and inactive or missing tenants, and returns the persisted
tenant ID. Missing or unresolved keys receive `401`; authenticated request
context contains the server-resolved tenant ID, not a client-selected tenant.

`/api/health` does not require authentication (the `/api` rate limiter still
applies). The legacy `/api/test-tenant` endpoint uses the development-only
in-memory resolver and is not the authentication path for workflow or
execution routes. The separate `x-tenant-id` context middleware only checks
the syntax of a client-supplied tenant identifier; it does not authenticate
or authorize access.

A client-supplied tenant ID is not proof of authorization. Before tenant data is accessed, tenant identity must be bound to a verified API key or authenticated session. Database queries must also enforce tenant isolation.

The current request-context middleware does not independently authenticate callers or authorize access to tenant data.

## 5. Tenant and Workflow Models

### Tenant

Represents an organization or customer using the platform.

- `name`: Required, trimmed tenant name.
- `slug`: Required, lowercase and trimmed; unique at the database index level.
- `status`: `active` or `inactive`, defaulting to `active`.
- `createdAt` and `updatedAt`: Managed by Mongoose timestamps.

### Workflow

Represents a workflow owned by a tenant.

- `tenantId`: Required MongoDB ObjectId reference to the Tenant model.
- `name`: Required, trimmed workflow name.
- `description`: Optional workflow description.
- `status`: `draft`, `active`, or `paused`, defaulting to `draft`.
- `version`: Defaults to 1, with a minimum value of 1.
- `createdAt` and `updatedAt`: Managed by Mongoose timestamps.

### Tenant Isolation and Authorization

- Resolve the caller's tenant context through trusted server-side authentication or API-key resolution.
- Authorize the caller before allowing access to tenant-owned resources.
- Scope every tenant-owned database read, update, and delete query to the authorized tenant.
- Never treat a client-supplied tenant ID as proof that the caller owns or may access that tenant.
- A Workflow's `tenantId` reference defines the data relationship; it does not independently enforce authorization or tenant isolation.
- Do not store API keys, credentials, or other secrets in the Tenant or Workflow models.

### Verification Status

TypeScript compilation passed without errors. A live MongoDB connection and actual database index creation were not verified as part of this task. The schema's unique index declaration does not by itself confirm that the index exists in a running database.
 main
