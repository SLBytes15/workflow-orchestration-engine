# Saga Readiness Test Matrix

**Owner:** Nithin  
**Date:** 22 October 2026  
**Status:** Test-plan/readiness artifact only; no Saga runtime implementation

## Scope and guardrails

This document prepares reviewable Saga scenarios while the existing execution foundation and UI work continue. It does not approve or implement Saga behavior. No unapproved field, endpoint, status, schema, retry policy, or compensation contract is introduced.

## Existing test conventions and evidence

| Area | Existing file(s) | Evidence already present |
|---|---|---|
| Graph traversal | `backend/src/services/execution.runtime.test.ts` | Linear/condition traversal, missing input and invalid operand failures, graph immutability |
| Reusable graph inputs | `backend/src/services/executionGraphs.fixture.ts` and `.test.ts` | Linear and true/false condition graph factories; validation, execution order, independent factory results |
| Execution service | `backend/src/services/execution.service.test.ts` | Tenant-scoped start/read, workflow version and graph snapshot persistence, node results, failed execution persistence, persistence failures, history pagination/cursors |
| Execution routes | `backend/src/routes/execution.routes.test.ts` | API-key auth, start/get/history behavior, invalid IDs/inputs, safe error mapping |
| Execution record | `backend/src/models/WorkflowExecution.ts` | Current statuses: `queued`, `running`, `completed`, `failed`; graph snapshot, node results, error, tenant/workflow/version IDs and timestamps |

## Current coverage boundary

No current production source or test match was found for Saga, compensation, retry, or idempotency behavior.

The scenarios below are therefore proposed and must not be reported as implemented or passing.

Existing execution tests use in-memory fixtures, mocked services, or mocked model dependencies. They do not prove a live MongoDB restart/recovery path.

## Proposed first-milestone matrix

The first milestone is intentionally linear:

`A succeeds → B succeeds → C fails → compensate B → compensate A`

| ID | Scenario | Setup | Action | Expected result | Current status / suggested test file |
|---|---|---|---|---|---|
| S-01 | Linear failure starts compensation | Three ordered tasks A/B/C; A and B succeed; C fails | Run the workflow | Original C failure remains identifiable; compensation is requested only for successful compensatable steps | Proposed; `backend/src/services/saga.runtime.test.ts` after contract approval |
| S-02 | Reverse-order compensation | Same as S-01 | Start compensation | B compensation runs before A compensation | Proposed; same file |
| S-03 | Failed task is not compensated | Make B fail and ensure A succeeds | Start compensation | B is not compensated; only eligible prior successful steps are considered | Proposed; same file |
| S-04 | Skipped task is not compensated | Arrange a skipped step before a later failure | Start compensation | Skipped step is excluded from compensation | Proposed; same file |
| S-05 | Compensation failure is separate | A/B succeed; C fails; B compensation fails | Run compensation | Original C failure and B compensation failure remain separately inspectable | Proposed; same file plus persistence test |
| S-06 | Retry expectation | Simulate a retryable task or compensation error | Retry according to approved policy | Retry count and terminal outcome follow the approved policy; no invented default | Proposed; `backend/src/services/saga.policy.test.ts` or runtime test |
| S-07 | Idempotency expectation | Submit the same compensation request twice | Repeat the request | Duplicate request does not apply compensation twice, according to approved key/state policy | Proposed; route/service test after contract approval |
| S-08 | Restart/service-error progress | Persist progress, then simulate restart or service failure | Resume or inspect execution if architecture supports it | Persisted progress remains inspectable; resume semantics are explicit rather than assumed | Proposed; integration test requiring the approved persistence harness |
| S-09 | Tenant isolation | Tenant A and Tenant B have separate execution/compensation records | Read, start, or compensate using the other tenant context | Cross-tenant records are not returned or modified | Proposed; route/service integration tests with tenant-scoped fixtures |

## Contract questions for Saransh

These decisions remain open and must not be finalized independently:

1. How does a task declare its compensation action without adding an unapproved graph field?
2. What original task output or context is supplied to compensation?
3. Which task types support compensation in milestone one?
4. Are execution and per-step compensation statuses new fields, nested records, or a separate record?
5. Does compensation always follow reverse completion order, excluding failed and skipped steps?
6. How are compensation failures, retries, and idempotency represented and persisted?
7. What API and tenant-scope behavior must remain unchanged?

## Definition of evidence

- **Covered:** An existing test asserts the behavior and passes in the recorded command run.
- **Proposed:** A scenario is described here, but no current implementation or test proves it.
- **Not verified:** The behavior requires a live MongoDB or a persistence/restart harness that is not present in the current test setup.

## Commands and actual results

The following results were recorded from the terminal:

| Command | Actual result |
|---|---|
| `cd backend && npm test` | 10 suites, 154 tests, 154 pass, 0 fail, 3229.1674ms |
| `cd backend && npm run build` | `tsc`, exit 0 |

## Non-goals

No Saga runtime, compensation executor, retry policy, idempotency implementation, schema change, route change, frontend change, or shared contract edit is included in this task.