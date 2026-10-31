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

## 7. Process Restart, Resume Tokens & Failure Handling

### 7.1 Resume Token Persistence (Verified in Code)
- **Current Behavior:** The Change Stream watcher factory initializes `BusinessEventModel.watch([{ $match: { operationType: "insert" } }], { fullDocument: "updateLookup" })` with no `resumeAfter`, `startAfter`, or `startAtOperationTime` parameters.
- **State Storage:** Resume tokens (MongoDB `_id` change stream tokens) are **not persisted** to disk, MongoDB, or any external cache.
- **Implementation Status:** Unimplemented in the current MVP.

### 7.2 Process Restart & Offline Event Handling (Verified in Code)
- **Restart Semantics:** A new Change Stream is opened when the watcher starts. Because no resume token is persisted or supplied, the application does not implement historical event backfill or restart recovery.
- **Downtime Events:** Business events inserted into `business_events` while the engine is offline, restarting, or disconnected are not backfilled or replayed retrospectively upon restart.
- **Queue Durability:** The in-memory processing queue (`processingQueue`) is not durable; queued work may be lost if the process terminates unexpectedly (e.g. `SIGKILL`, crash, or power loss).

### 7.3 Stream Error and Close Behavior (Verified in Code)
- **Error Listener:** `stream.on("error", (error) => { logger.error(...) })` logs the error message to the console.
- **Close Listener:** `stream.on("close", () => { logger.info("Change stream closed") })` logs the stream closure.
- **No Automatic Reconnection:** The watcher does not implement automatic reconnection or an automated retry supervisor. If the stream encounters a fatal error or closes unexpectedly:
  - The error is logged to prevent an unhandled crash.
  - The stream remains closed.
  - Subsequent insert events will not be detected until the backend application is restarted.

### 7.4 Reconnection, Retries & Dispatch Failures (Verified in Code)
- **Reconnection:** Not implemented.
- **Dispatch Failures & Retries:** If workflow dispatch (`dependencies.startExecution`) throws an error during event handling, the watcher catches and logs the failure without terminating the watcher. The watcher does not retry dispatch, re-queue the event, or forward it to a dead-letter queue.
- **Deduplication:** There is no event-level deduplication mechanism in the watcher. A single business event legitimately dispatches to each active workflow whose trigger configuration matches. Duplicate event documents in the database may result in duplicate workflow executions.
- **Historical Replay:** Not implemented. There is no API or background job to rewind or replay historical `business_events` documents.

---

## 8. MVP Limitations & Mid-Review Demonstration Guidelines

### 8.1 Practical Limitations
- **Insert Operations Only:** Deletes, updates, and replacements do not trigger workflows.
- **Delivery Guarantee:** Best-effort event dispatch with no formal delivery, deduplication, or exactly-once guarantees:
  - Events inserted while the watcher is offline or disconnected are not backfilled.
  - Exactly-once execution is not guaranteed.
  - A single event matching multiple active workflows triggers separate executions for each workflow.
  - Duplicate event documents in `business_events` will trigger separate executions.
- **Dead-Letter Queue & Retries:** Automated retries and dead-letter queues are not implemented in this MVP.
- **MongoDB Replica Set Prerequisite:** Native MongoDB Change Streams require a replica set or sharded cluster; running against a standalone mongod instance throws `ChangeStream is only supported on replica sets`.

### 8.2 Demonstration Guidelines for Mid-Review
1. **Startup Order in Demos:** The backend server (`npm run dev` or `npm start`) must be fully initialized and show `[STARTUP] Change stream watcher started successfully` **before** any test business events are inserted into the database. Events inserted prior to watcher startup will be missed.
2. **Environment Selection:** For live demonstrations, MongoDB must run with a replica set configured (e.g. local single-node replica set `mongod --replSet rs0` or Atlas cluster). If demonstrating in an offline or single-node standalone environment, demonstrate using the verified in-memory fake test suite (`changeStreamWatcher.service.test.ts`), which validates all dispatch logic without replica set requirements.
3. **Handling Connection Drops:** If the database connection drops or MongoDB restarts during a demonstration, restart the backend Node.js process to establish a fresh Change Stream watcher.
