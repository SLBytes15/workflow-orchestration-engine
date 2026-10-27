 # Workflow & Saga Orchestration Engine

## Project Overview
A team project to build a workflow orchestration platform that executes multi-step workflows, tracks execution status, and handles failures.

## Project Status
Initial repository setup.

## Planned Technology Stack
- Frontend: React
- Backend: Node.js and Express.js
- Database: MongoDB

## Team
Four-member internship team.

## Development Approach
- Work through individual Git branches.
- Test changes before merging.
- Document setup instructions and implementation decisions.
- Add features incrementally and verify them before marking them complete.

## Current Scope
Requirements analysis and project setup. Implementation details are pending confirmation against the official project brief.

## Workflow Execution

The backend exposes tenant-authenticated endpoints for starting workflow executions and retrieving execution history and details. The POST handler calls the execution service directly; the service creates a queued record, transitions it to running, invokes `executeWorkflowGraph()` in the request path, and persists the terminal result. Workflow lookup, execution updates, history, and detail queries are scoped by tenant ID. The service persists compensation checkpoints supplied by the runtime and surfaces errors when checkpoint or terminal-result persistence cannot be confirmed. This does not establish that compensation handlers always succeed or that the system is production-ready or worker-based.

Previously recorded manual verification (not rerun for this documentation update) includes a basic trigger-to-unconfigured-task workflow completing, its execution remaining readable after a backend process restart, and tested temporary-tenant requests being unable to retrieve another tenant's execution. These observations are historical and do not establish comprehensive tenant isolation.

Browser end-to-end execution and external task integrations remain unverified. MongoDB Change Streams and event-triggered workflow execution are Week 2 requirements, but remain pending/unverified here: the inspected implementation does not establish an event source, tenant-ownership contract, payload schema, or delivery guarantees.
