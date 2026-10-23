# Saga Runtime Test Design

**Owner:** Nithin
**Date:** 23 October 2026
**Scope:** Test design and isolated runtime-readiness planning
**Implementation status:** No production runtime edits in this task

## Objective

Define four deterministic Saga scenarios for the first runtime slice.

The scenarios cover:

1. A task failure after a previous task succeeds.
2. Compensation of the previously successful task.
3. Reverse-order compensation for two successful tasks.
4. Compensation failure while preserving the original task error separately.

This document describes expected behavior and persisted state. It does not implement Saga runtime behavior.

## Ownership boundary

Saransh owns:

- The registered action interface.
- The compensation-action interface.
- Runtime and service integration.
- Action registration and lookup.
- Persistence sequencing before and after compensation actions.
- Final decisions about action input, output, and structured errors.

Nithin owns:

- Deterministic scenario design.
- Expected action order.
- Expected execution status.
- Expected node status.
- Expected compensation status.
- Expected original and compensation error separation.
- Test assertions after the runtime interface is approved.

This task must not introduce a competing action interface or schema.

## Verified latest-main contract

The current `WorkflowExecution` model on `main` supports these execution statuses:

- `queued`
- `running`
- `completed`
- `failed`
- `compensating`
- `compensated`
- `compensation_failed`

The current node-result contract supports:

- Node status: `completed`, `failed`, or `skipped`
- Optional node output
- Optional original node error with `code` and `message`
- Optional compensation metadata

The current node compensation metadata supports:

- Compensation status: `pending`, `running`, `completed`, or `failed`
- `startedAt`
- `completedAt`
- Optional compensation error with `code` and `message`

The merged model contract does not by itself prove that a live Saga executor produces these states.

## Proposed action interface for Saransh review

The following is a documentation-only type sketch. It is not a production implementation and must not be treated as the final contract until Saransh approves it.

```ts
type ActionIdentifier = string;

interface StructuredActionError {
  code: string;
  message: string;
}

interface TaskActionInput {
  executionId: string;
  tenantId: string;
  nodeId: string;
  input: unknown;
}

interface TaskActionResult {
  output: unknown;
}

interface TaskAction {
  actionId: ActionIdentifier;
  run(input: TaskActionInput): Promise<TaskActionResult>;
}

interface CompensationActionInput {
  executionId: string;
  tenantId: string;
  nodeId: string;
  originalInput: unknown;
  originalOutput: unknown;
}

interface CompensationAction {
  actionId: ActionIdentifier;
  compensate(
    input: CompensationActionInput,
  ): Promise<TaskActionResult>;
}
```

The final approved interface must define:

- How action identifiers are registered.
- How validated input is represented.
- How action output is returned.
- How structured action errors are returned.
- How the compensation action identifier is selected.
- What original input and output are supplied to compensation.
- How tenant-scoped access is enforced.

## Concrete interface example for review

This example is illustrative only. It does not add a production action or compensation implementation.

```ts
const exampleAction = {
  actionId: "reserve-inventory",
  run: async (input: TaskActionInput): Promise<TaskActionResult> => {
    return {
      output: {
        reservationId: "reservation-from-approved-test-double",
        nodeId: input.nodeId,
      },
    };
  },
};

const exampleCompensation = {
  actionId: "release-inventory",
  compensate: async (
    input: CompensationActionInput,
  ): Promise<TaskActionResult> => {
    return {
      output: {
        releasedReservationId: input.originalOutput,
        nodeId: input.nodeId,
      },
    };
  },
};
```

The example must remain a test-double example until the runtime owner approves the actual registration, validation, and execution mechanism.

## Scenario A — Previous task succeeds and next task fails

### Setup

Use a deterministic linear workflow:

```text
Task A → Task B
```

Configure:

- Task A action succeeds.
- Task B action fails with a structured task error.
- Task A has an approved compensation action.
- Task B is not considered successfully completed.

### Expected action order

```text
Task A action
Task B action
```

No compensation action should run before the execution enters compensation handling.

### Expected persisted execution state

| Field | Expected value |
|---|---|
| Execution status | `failed` before compensation begins, or `compensating` if compensation starts immediately under the approved runtime contract |
| Original execution error | Contains Task B's structured error |
| Node A status | `completed` |
| Node B status | `failed` |
| Node B error | Contains Task B's original structured error |
| Node B compensation | Not present or not eligible for compensation |

### Required assertions

- Task A action was called exactly once.
- Task B action was called exactly once.
- Task B failure is preserved.
- Task B is not treated as successfully completed.
- Task B is not compensated.

## Scenario B — Compensation runs for the previously successful task

### Setup

Use the same workflow:

```text
Task A → Task B
```

Configure:

- Task A succeeds.
- Task B fails.
- Task A has an approved compensation action.

### Expected action order

```text
Task A action
Task B action
Task A compensation action
```

### Expected persisted execution state

| Field | Expected value |
|---|---|
| Final execution status | `compensated` if Task A compensation succeeds |
| Original execution error | Preserved from Task B |
| Node A status | `completed` |
| Node A compensation status | `completed` |
| Node B status | `failed` |
| Node B compensation | Not present or not eligible |

### Required assertions

- Task A compensation runs exactly once.
- Task B compensation does not run.
- The original Task B error remains available.
- Task A compensation metadata records successful completion.
- The action order is exactly:

```text
Task A action → Task B action → Task A compensation action
```

## Scenario C — Two successful tasks compensate in reverse completion order

### Setup

Use a deterministic linear workflow:

```text
Task A → Task B → Task C
```

Configure:

- Task A succeeds.
- Task B succeeds.
- Task C fails.
- Task A and Task B both have approved compensation actions.

### Expected action order

```text
Task A action
Task B action
Task C action
Task B compensation action
Task A compensation action
```

### Expected persisted execution state

| Field | Expected value |
|---|---|
| Final execution status | `compensated` if both compensations succeed |
| Original execution error | Preserved from Task C |
| Node A status | `completed` |
| Node A compensation status | `completed` |
| Node B status | `completed` |
| Node B compensation status | `completed` |
| Node C status | `failed` |
| Node C compensation | Not present or not eligible |

### Required assertions

- Task B compensation runs before Task A compensation.
- Each successful task is compensated exactly once.
- Task C is not compensated because it failed.
- The exact compensation order is reverse completion order:

```text
Task B compensation action → Task A compensation action
```

- The original Task C error remains available.

## Scenario D — Compensation fails while the original error remains available

### Setup

Use the following workflow:

```text
Task A → Task B
```

Configure:

- Task A succeeds.
- Task B fails with the original task error.
- Task A compensation starts.
- Task A compensation fails with a separate compensation error.

Example error categories:

| Error | Example code | Meaning |
|---|---|---|
| Original task error | `TASK_B_FAILED` | Task B failed during forward execution |
| Compensation error | `TASK_A_COMPENSATION_FAILED` | Task A compensation failed during rollback |

The exact error codes must be finalized by the approved runtime contract.

### Expected action order

```text
Task A action
Task B action
Task A compensation action
```

### Expected persisted execution state

| Field | Expected value |
|---|---|
| Final execution status | `compensation_failed` |
| Original execution error | Still contains Task B's original error |
| Node A status | `completed` |
| Node A compensation status | `failed` |
| Node A compensation error | Contains the separate compensation error |
| Node B status | `failed` |
| Node B error | Still contains Task B's original error |
| Node B compensation | Not present or not eligible |

### Required assertions

- The original Task B error is not overwritten.
- The Task A compensation error is stored separately.
- The final execution status is `compensation_failed`.
- The compensation failure does not change Task B's original error.
- Task A compensation is not silently reported as successful.

## Test assertion checklist

Once Saransh's action and compensation interfaces are approved, executable tests must assert:

- Exact forward action order.
- Exact compensation action order.
- No compensation for failed tasks.
- No compensation for skipped tasks.
- Compensation is reverse completion order.
- Each action runs only once within the scenario.
- Execution status transitions.
- Per-node forward status.
- Per-node compensation status.
- Original task error preservation.
- Separate compensation error persistence.
- Tenant-scoped access remains unchanged.

## Current implementation blocker

The current repository contains the compensation persistence contract but does not yet contain:

- A Saga runtime executor.
- A registered task-action interface.
- A registered compensation-action interface.
- Action input validation.
- Action result and output handling.
- Runtime compensation sequencing.
- Runtime persistence before and after each compensation action.

Therefore, executable Saga runtime tests must not be added until Saransh publishes the approved interface and test integration point.

## Non-goals

This task does not implement:

- Saga runtime behavior.
- Compensation execution.
- Automatic retries.
- Automatic recovery.
- Crash replay.
- Exactly-once execution.
- Arbitrary user-supplied JavaScript.
- A generic plugin framework.
- New model fields.
- New routes.
- Frontend changes.
- Tenant-isolation redesign.

## Validation evidence

| Command | Actual result |
|---|---|
| `cd backend && npm test` | 10 suites, 170 tests, 170 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo, duration 4569.8258ms |
| | `cd backend && npm run build` | TypeScript build completed successfully; exit 0 |

The test result above is from the current test run. The build result must be updated only from the actual `npm run build` output.

## Next step after interface approval

After Saransh approves the action and compensation interfaces:

1. Add executable tests for Scenario A.
2. Add executable tests for Scenario B.
3. Add executable tests for Scenario C.
4. Add executable tests for Scenario D.
5. Run the focused Saga tests.
6. Run the relevant backend test suite.
7. Record the exact output.
8. Keep runtime changes limited to the approved ownership boundary.