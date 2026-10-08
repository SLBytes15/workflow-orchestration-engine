# Multi-Tenant Distributed Workflow & Saga Orchestration Engine

## 1. Project Overview

The project is a distributed workflow automation engine that allows
enterprise users to construct and execute multi-step workflows using
a visual Directed Acyclic Graph (DAG).

The Node.js backend coordinates workflow execution, asynchronous tasks,
retries, and compensation logic when downstream operations fail.

## 2. Project Goals

- Support tenant-isolated workflows.
- Allow users to visually construct workflows.
- Validate workflow graphs.
- Execute workflows through a backend orchestration engine.
- Handle failures and retries.
- Support Saga-style compensation.
- Provide execution monitoring and tracing.
- Provide administrative monitoring capabilities.

## 3. Technology Stack

- TypeScript
- React
- Node.js
- Express.js
- MongoDB
- React Flow
- WebSockets
- Docker
- AWS ECS / Kubernetes as applicable

## 4. Weekly Requirements

### Week 1

- Multi-tenant MongoDB isolation strategy.
- Visual DAG workflow canvas.
- Node validation.
- Conditional branching.
- Loop detection.
- Tenant context routing.
- Rate limiting.
- Cryptographic API-key management.

### Week 2

- State-machine execution engine.
- Saga compensation logic.
- MongoDB Change Streams.
- Event-triggered workflow execution.

### Week 3

- Isolated transformation-script execution.
- WebSocket execution tracing.
- Dead-letter queue.
- Configurable retry policies.

### Week 4

- Administrative dashboard.
- Tenant quota monitoring.
- Failure heatmaps.
- Worker latency monitoring.
- 1,000+ concurrent execution stress testing.
- Docker containerization.
- Worker scaling using AWS ECS or Kubernetes.

## 5. Open Questions

- Exact tenant-isolation strategy to be used.
- Exact execution/queue architecture.
- Infrastructure limits and credentials.
- Exact evaluation method for 1,000+ concurrent executions.
- Exact final-review date.
- Expected external API/test-service environment.