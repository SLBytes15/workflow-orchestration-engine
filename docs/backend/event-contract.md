# MVP Business-Event Contract & Validation

**Status:** Agreed Team Contract (Week 2 MVP)  
**Scope:** MongoDB Business-Event Schema, Trigger Configuration, Tenant Boundaries, and Execution Envelope

---

## 1. Overview and Source Collection

For the Week 2 MVP, the engine supports business-event triggered workflows watching a single dedicated MongoDB collection:

- **Approved Source Collection:** `business_events`
- **Supported Operations:** `insert` events only. Updates, replacements, and deletes are ignored by the MVP watcher.
- **Excluded Sources:** Domain collections like `orders`, internal engine collections like `workflows` and `workflowexecutions`, or arbitrary user-specified collections are strictly rejected.

---

## 2. Event Document Contract

Every document stored in or read from the `business_events` collection must conform to the following structure:

```json
{
  "_id": "MongoDB-generated ObjectId",
  "tenantId": "valid top-level MongoDB ObjectId",
  "eventName": "order.created",
  "payload": {
    "orderId": "ORD-1234",
    "status": "pending",
    "amount": 250
  },
  "createdAt": "2026-10-27T12:00:00.000Z",
  "updatedAt": "2026-10-27T12:00:00.000Z"
}
```

### Validation Rules
1. `_id`: Valid MongoDB ObjectId.
2. `tenantId`: Valid top-level MongoDB ObjectId. Immutable after insertion.
3. `eventName`: Non-empty string (e.g. `"order.created"`).
4. `payload`: Plain JSON object containing domain event data. Any internal metadata (`_id`, `tenantId`) present inside `payload` is stripped during validation to prevent identity spoofing.

---

## 3. Workflow Trigger Configuration

Workflows triggered by business events use the canonical DAG node configuration:

```json
{
  "kind": "event",
  "source": "business_events",
  "eventName": "order.created",
  "filter": {
    "payload.status": "pending",
    "payload.amount": 100
  }
}
```

### Validation Rules:
1. `kind`: Must be literally `"event"`.
2. `source`: Must equal `"business_events"`. All other collection names are rejected during graph creation, update, and workflow activation.
3. `eventName`: Must be a non-empty string.
4. `filter` (optional):
   - Must be a plain object of key-value equality pairs.
   - Keys must begin with `"payload."` (e.g. `"payload.status"`).
   - Keys targeting `tenantId` (e.g. `"tenantId"` or `"payload.tenantId"`) are rejected to prevent overriding tenant boundaries.
   - MongoDB operator syntax (keys starting with `$`) is rejected.
   - Values must be scalar equality primitives (`string`, `number`, `boolean`, `null`).

---

## 4. Tenant Isolation and Trust Boundary

- **Trusted Tenant Identity:** The event's tenant identity is strictly established from the top-level `tenantId` field of the validated `business_events` document.
- **Zero Trust for Payload Identifiers:** Any client-supplied tenant identifier inside `payload` is ignored and deleted.
- **Cross-Tenant Prevention:** An event for Tenant A can only match and trigger active workflows owned by Tenant A. Cross-tenant dispatch is blocked.

---

## 5. Execution Input Envelope

When an event triggers an active workflow, the execution service receives this sanitized, documented input envelope:

```json
{
  "eventId": "<event document ObjectId as string>",
  "eventName": "order.created",
  "source": "business_events",
  "payload": {
    "orderId": "ORD-1234",
    "status": "pending",
    "amount": 250
  }
}
```

Internal MongoDB metadata (`_id`, `tenantId`, `__v`) is omitted from `payload`, and the canonical identifier is exposed as `eventId`.

---

## 6. Change Stream Watcher Architecture & Dispatch Flow

The watcher service (`createChangeStreamWatcherService`) listens for change events on `business_events` in the connected MongoDB database:

1. **Filtering by Operation:** Ignores all change events except `insert`.
2. **Document Validation:** Validates the inserted document via `validateBusinessEventDocument`. Corrupted, non-object, or documents missing `_id`, `tenantId`, or `eventName` are safely ignored with a warning and do not crash the watcher.
3. **Tenant Querying:** Queries active workflows for the event's `tenantId` via `findActiveWorkflowsByTenant(tenantId)`. Only workflows with `status === "active"` are eligible.
4. **Tenant Isolation Enforcement:** Ensures `workflow.tenantId` matches the validated top-level `event.tenantId`.
5. **Trigger Matching:** Inspects `workflow.graph.nodes` for a `trigger` node where:
   - `data.config.kind === "event"`
   - `data.config.source === "business_events"`
   - `data.config.eventName === event.eventName`
   - `matchEventFilter(data.config.filter, event) === true`
6. **Dispatch:** Calls `executionService.startExecution(tenantId, workflowId, executionEnvelope)`.

### Sequential Event Processing
Change stream events are queued in a strict sequential promise chain. Each event completes its database queries and workflow dispatches before the next queued event begins processing, avoiding overlapping dispatch loops or race conditions.

### Fault Tolerance & Isolation
Dispatch failures for a single workflow or invalid event are caught and logged without terminating the watcher or blocking subsequent events.

### Lifecycle & Graceful Shutdown
- **Startup:** The watcher starts in `index.ts` only after `connectDatabase()` resolves successfully.
- **Graceful Shutdown:** `SIGTERM` and `SIGINT` signals invoke `stop()`. `stop()` immediately closes the Change Stream to reject new events and waits for currently queued events to complete before exiting. Repeated calls to `stop()` are safe and idempotent.

---

## 7. MVP Limitations & Operational Guarantees

- **Insert Operations Only:** Deletes, updates, and replacements do not trigger workflows.
- **No Exactly-Once Delivery Guarantee:** At-most-once or at-least-once depends on connection stability; network partitions or server crashes may cause missed events or duplicate executions. Exactly-once is not guaranteed in this MVP.
- **No Resume Token Persistence:** In this MVP slice, resume tokens are not persisted across process restarts. If the process is stopped or restarts, events inserted during downtime are not automatically replayed.
- **No Dead-Letter Queue (DLQ):** Failed workflow executions record failure in `WorkflowExecution` records but are not retried or forwarded to a dead-letter queue.
- **MongoDB Replica Set Prerequisite:** Real MongoDB Change Streams require a replica set or sharded cluster; local testing without an active replica set is performed using the verified fake-based dependency-injected test suite.

