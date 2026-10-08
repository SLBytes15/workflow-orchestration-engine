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