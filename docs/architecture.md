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


### Tenant Request Context and Authorization

The `x-tenant-id` middleware validates the presence and format of a tenant identifier and makes it available to downstream handlers.

A client-supplied tenant ID is not proof of authorization. Before tenant data is accessed, tenant identity must be bound to a verified API key or authenticated session. Database queries must also enforce tenant isolation.

The current request-context middleware does not independently authenticate callers or authorize access to tenant data.