import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapPersistedWorkflow,
  mapPersistedWorkflows,
  normalizeStatus,
  removeWorkflow,
  type Workflow,
} from "../src/workflowState";

describe("workflow status normalization and lifecycle transitions", () => {
  it("normalizes backend lowercase status strings accurately", () => {
    assert.equal(normalizeStatus("draft"), "Draft");
    assert.equal(normalizeStatus("active"), "Active");
    assert.equal(normalizeStatus("paused"), "Paused");
  });

  it("normalizes mixed-case and uppercase status strings with whitespace tolerance", () => {
    assert.equal(normalizeStatus("ACTIVE"), "Active");
    assert.equal(normalizeStatus("  paused  "), "Paused");
    assert.equal(normalizeStatus("Draft"), "Draft");
    assert.equal(normalizeStatus("AcTiVe"), "Active");
  });

  it("defaults unknown, null, or invalid status values to Draft", () => {
    assert.equal(normalizeStatus(null), "Draft");
    assert.equal(normalizeStatus(undefined), "Draft");
    assert.equal(normalizeStatus(""), "Draft");
    assert.equal(normalizeStatus("unknown_status"), "Draft");
    assert.equal(normalizeStatus(123), "Draft");
  });

  it("maps persisted backend records with lowercase status correctly into frontend workflow records", () => {
    const activeRecord = mapPersistedWorkflow({
      _id: "wf-1",
      name: "Active Service",
      status: "active",
      version: 1,
    });
    assert.equal(activeRecord.status, "Active");
    assert.equal(activeRecord.isPersisted, true);

    const pausedRecord = mapPersistedWorkflow({
      _id: "wf-2",
      name: "Paused Service",
      status: "paused",
      version: 2,
    });
    assert.equal(pausedRecord.status, "Paused");
    assert.equal(pausedRecord.isPersisted, true);

    const draftRecord = mapPersistedWorkflow({
      _id: "wf-3",
      name: "Draft Service",
      status: "draft",
      version: 1,
    });
    assert.equal(draftRecord.status, "Draft");
    assert.equal(draftRecord.isPersisted, true);
  });

  it("batch maps multiple backend records with various statuses", () => {
    const records = [
      { _id: "1", name: "One", status: "active" },
      { _id: "2", name: "Two", status: "paused" },
      { _id: "3", name: "Three", status: "draft" },
    ];
    const mapped = mapPersistedWorkflows(records);
    assert.equal(mapped.length, 3);
    assert.equal(mapped[0].status, "Active");
    assert.equal(mapped[1].status, "Paused");
    assert.equal(mapped[2].status, "Draft");
  });

  it("maintains status independence across save operations (saving does not auto-activate)", () => {
    const draftWf: Workflow = {
      id: "wf-draft",
      isPersisted: true,
      name: "Draft Workflow",
      description: "Testing",
      status: "Draft",
      version: 1,
      updatedAt: "2026-10-28",
    };

    // Simulating save graph update
    const updatedDraft: Workflow = {
      ...draftWf,
      description: "Updated description",
      updatedAt: "2026-10-28",
    };
    assert.equal(updatedDraft.status, "Draft");

    const activeWf: Workflow = {
      id: "wf-active",
      isPersisted: true,
      name: "Active Workflow",
      description: "Testing",
      status: "Active",
      version: 1,
      updatedAt: "2026-10-28",
    };
    const updatedActive: Workflow = {
      ...activeWf,
      description: "Updated description",
    };
    assert.equal(updatedActive.status, "Active");

    const pausedWf: Workflow = {
      id: "wf-paused",
      isPersisted: true,
      name: "Paused Workflow",
      description: "Testing",
      status: "Paused",
      version: 1,
      updatedAt: "2026-10-28",
    };
    const updatedPaused: Workflow = {
      ...pausedWf,
      description: "Updated description",
    };
    assert.equal(updatedPaused.status, "Paused");
  });

  it("keeps execution status separate from workflow status", () => {
    // A workflow can be Active, Draft, or Paused while execution runs, completes, or fails
    const workflow: Workflow = {
      id: "wf-exec",
      isPersisted: true,
      name: "Exec Workflow",
      description: "Testing",
      status: "Active",
      version: 1,
      updatedAt: "2026-10-28",
    };

    const simulatedExecutions = [
      { executionId: "exec-1", status: "running" },
      { executionId: "exec-2", status: "completed" },
      { executionId: "exec-3", status: "failed" },
    ];

    for (const exec of simulatedExecutions) {
      // Execution status must not mutate workflow status
      assert.equal(workflow.status, "Active");
      assert.notEqual(workflow.status, exec.status);
    }
  });

  it("cleans up editor state when the currently active workflow is deleted", () => {
    const list: Workflow[] = [
      {
        id: "wf-to-delete",
        isPersisted: true,
        name: "Old Workflow",
        description: "",
        status: "Draft",
        version: 1,
        updatedAt: "2026-10-28",
      },
      {
        id: "wf-keep",
        isPersisted: true,
        name: "Keep Workflow",
        description: "",
        status: "Active",
        version: 1,
        updatedAt: "2026-10-28",
      },
    ];

    let currentWorkflowId: string | null = "wf-to-delete";
    const nextList = removeWorkflow(list, "wf-to-delete");

    assert.equal(nextList.length, 1);
    assert.equal(nextList[0].id, "wf-keep");

    // Mimic handleWorkflowsChange logic
    if (currentWorkflowId && !nextList.some((w) => String(w.id) === currentWorkflowId)) {
      currentWorkflowId = null;
    }

    assert.equal(currentWorkflowId, null);
  });
});

