# System Architecture

## 1. High-Level Architecture

React Client
    |
    | HTTP / WebSocket
    v
Express API
    |
    v
Tenant Context
    |
    v
Workflow Service
    |
    v
MongoDB

Future execution components:

Workflow Service
    |
    v
Execution Engine
    |
    +---- Task Runner
    |
    +---- Saga Coordinator
    |
    +---- Retry / DLQ
    |
    +---- Execution Events


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
Provides execution tracing to the frontend.

## 3. Architecture Decisions

To be finalized after requirements analysis.

## 4. Open Technical Decisions

- Tenant isolation approach
- Queue/execution architecture
- Worker architecture
- Authentication/API-key design
- WebSocket event structure


- Header: x-api-key
- Missing or invalid key: 401 Unauthorized
- Successful resolution: attach tenantId and tenantKey to the request context
- Resolver: temporary in-memory lookup for development only
- /api/health: public
- Future work: MongoDB-backed lookup, secure API-key verification, and rate limiting

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
