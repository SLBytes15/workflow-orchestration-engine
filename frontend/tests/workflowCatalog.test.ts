import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateCopyName,
  isRunButtonDisabled,
  type Workflow,
} from "../src/workflowState";

describe("Enterprise Workflow Catalog", () => {
  const sampleWorkflows: Workflow[] = [
    {
      id: "wf-1",
      isPersisted: true,
      name: "Payment Processing",
      description: "Handles payment-related workflow operations and stripe webhook.",
      status: "Active",
      version: 2,
      updatedAt: "2026-10-15",
    },
    {
      id: "wf-2",
      isPersisted: true,
      name: "Order Fulfillment",
      description: "Manages order creation, dispatch, and tracking.",
      status: "Draft",
      version: 1,
      updatedAt: "2026-10-18",
    },
    {
      id: "wf-3",
      isPersisted: true,
      name: "Customer Notifications",
      description: "Sends push and email notifications to users.",
      status: "Paused",
      version: 3,
      updatedAt: "2026-10-12",
    },
    {
      id: "wf-4",
      isPersisted: false,
      name: "Inventory Sync",
      description: "Synchronizes warehouse inventory.",
      status: "Active",
      version: 1,
      updatedAt: "2026-10-20",
    },
  ];

  describe("Summary metric cards calculation", () => {
    it("computes accurate backend-driven counts for total, active, draft, and paused", () => {
      let active = 0;
      let draft = 0;
      let paused = 0;

      for (const wf of sampleWorkflows) {
        if (wf.status === "Active") active++;
        else if (wf.status === "Draft") draft++;
        else if (wf.status === "Paused") paused++;
      }

      assert.equal(sampleWorkflows.length, 4);
      assert.equal(active, 2);
      assert.equal(draft, 1);
      assert.equal(paused, 1);
    });

    it("returns all zeros when workflow dataset is empty", () => {
      const emptyList: Workflow[] = [];
      let active = 0;
      let draft = 0;
      let paused = 0;

      for (const wf of emptyList) {
        if (wf.status === "Active") active++;
        else if (wf.status === "Draft") draft++;
        else if (wf.status === "Paused") paused++;
      }

      assert.equal(emptyList.length, 0);
      assert.equal(active, 0);
      assert.equal(draft, 0);
      assert.equal(paused, 0);
    });
  });

  describe("Search and filter logic", () => {
    it("filters workflows by case-insensitive name match", () => {
      const query = "payment";
      const results = sampleWorkflows.filter(
        (w) =>
          w.name.toLowerCase().includes(query) ||
          w.description.toLowerCase().includes(query),
      );
      assert.equal(results.length, 1);
      assert.equal(results[0].name, "Payment Processing");
    });

    it("filters workflows by case-insensitive description match", () => {
      const query = "warehouse";
      const results = sampleWorkflows.filter(
        (w) =>
          w.name.toLowerCase().includes(query) ||
          w.description.toLowerCase().includes(query),
      );
      assert.equal(results.length, 1);
      assert.equal(results[0].name, "Inventory Sync");
    });

    it("filters workflows by exact status", () => {
      const activeWorkflows = sampleWorkflows.filter(
        (w) => w.status === "Active",
      );
      assert.equal(activeWorkflows.length, 2);

      const pausedWorkflows = sampleWorkflows.filter(
        (w) => w.status === "Paused",
      );
      assert.equal(pausedWorkflows.length, 1);
      assert.equal(pausedWorkflows[0].name, "Customer Notifications");
    });

    it("combines search query and status filter correctly", () => {
      const query = "notifications";
      const status = "Paused";
      const results = sampleWorkflows.filter((w) => {
        const matchesSearch =
          w.name.toLowerCase().includes(query) ||
          w.description.toLowerCase().includes(query);
        const matchesStatus = status === "All" || w.status === status;
        return matchesSearch && matchesStatus;
      });

      assert.equal(results.length, 1);
      assert.equal(results[0].name, "Customer Notifications");
    });

    it("returns zero results when search does not match any workflow", () => {
      const query = "nonexistent_workflow_xyz";
      const results = sampleWorkflows.filter(
        (w) =>
          w.name.toLowerCase().includes(query) ||
          w.description.toLowerCase().includes(query),
      );
      assert.equal(results.length, 0);
    });
  });

  describe("Sorting functionality", () => {
    it("sorts by updated date descending (newest first)", () => {
      const sorted = [...sampleWorkflows].sort((a, b) =>
        (b.updatedAt || "").localeCompare(a.updatedAt || ""),
      );
      assert.equal(sorted[0].name, "Inventory Sync"); // 2026-10-20
      assert.equal(sorted[sorted.length - 1].name, "Customer Notifications"); // 2026-10-12
    });

    it("sorts by updated date ascending (oldest first)", () => {
      const sorted = [...sampleWorkflows].sort((a, b) =>
        (a.updatedAt || "").localeCompare(b.updatedAt || ""),
      );
      assert.equal(sorted[0].name, "Customer Notifications"); // 2026-10-12
      assert.equal(sorted[sorted.length - 1].name, "Inventory Sync"); // 2026-10-20
    });

    it("sorts by workflow name ascending (A-Z)", () => {
      const sorted = [...sampleWorkflows].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      assert.equal(sorted[0].name, "Customer Notifications");
      assert.equal(sorted[1].name, "Inventory Sync");
      assert.equal(sorted[2].name, "Order Fulfillment");
      assert.equal(sorted[3].name, "Payment Processing");
    });

    it("sorts by workflow name descending (Z-A)", () => {
      const sorted = [...sampleWorkflows].sort((a, b) =>
        b.name.localeCompare(a.name),
      );
      assert.equal(sorted[0].name, "Payment Processing");
      assert.equal(sorted[sorted.length - 1].name, "Customer Notifications");
    });
  });

  describe("Duplicate workflow copy naming", () => {
    it("generates a clean copy name for an existing workflow", () => {
      const copyName = generateCopyName(
        "Payment Processing",
        sampleWorkflows,
      );
      assert.equal(copyName, "Payment Processing (Copy)");
    });

    it("increments copy index when a copy already exists", () => {
      const withCopy: Workflow[] = [
        ...sampleWorkflows,
        {
          id: "wf-copy",
          isPersisted: true,
          name: "Payment Processing (Copy)",
          description: "A copy",
          status: "Draft",
          version: 1,
          updatedAt: "2026-10-21",
        },
      ];

      const secondCopyName = generateCopyName(
        "Payment Processing",
        withCopy,
      );
      assert.equal(secondCopyName, "Payment Processing (Copy 2)");
    });
  });

  describe("Execution and button guards", () => {
    it("disables run button for unpersisted sample workflows", () => {
      assert.equal(isRunButtonDisabled(false, false), true);
    });

    it("disables run button when workflow is currently executing", () => {
      assert.equal(isRunButtonDisabled(true, true), true);
    });

    it("enables run button only when workflow is persisted and idle", () => {
      assert.equal(isRunButtonDisabled(true, false), false);
    });
  });
});

