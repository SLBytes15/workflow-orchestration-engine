import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createConditionNode,
  createTaskNode,
  createTriggerNode,
  type WorkflowFlowNode,
  type WorkflowNodeType,
} from "../src/components/workflow/nodes/node.types";
import {
  buildCanonicalGraphFromWizard,
  parseGraphToWizardState,
} from "../src/components/workflow/wizard/wizardState";
import {
  mapPersistedWorkflow,
} from "../src/workflowState";
import type { WorkflowGraph } from "../src/api/workflowApi";

/**
 * Simulates the unique node ID generation and node creation logic
 * used in NodePreview's drag-and-drop and toolbar handlers.
 */
function simulateCreateNode(
  existingNodes: WorkflowFlowNode[],
  type: WorkflowNodeType,
  position?: { x: number; y: number },
): WorkflowFlowNode | null {
  if (type === "trigger") {
    if (existingNodes.some((n) => n.type === "trigger")) return null;
    let index = 1;
    let id = `trigger-${index}`;
    while (existingNodes.some((n) => n.id === id)) {
      index += 1;
      id = `trigger-${index}`;
    }
    return createTriggerNode(id, position ?? { x: 250, y: 50 });
  }

  if (type === "task") {
    let index = existingNodes.length + 1;
    let id = `task-${index}`;
    while (existingNodes.some((n) => n.id === id)) {
      index += 1;
      id = `task-${index}`;
    }
    return createTaskNode(
      id,
      position ?? {
        x: 160 + (existingNodes.length % 3) * 240,
        y: 480 + (existingNodes.length % 2) * 120,
      },
    );
  }

  if (type === "condition") {
    let index = existingNodes.length + 1;
    let id = `condition-${index}`;
    while (existingNodes.some((n) => n.id === id)) {
      index += 1;
      id = `condition-${index}`;
    }
    return createConditionNode(
      id,
      position ?? {
        x: 160 + (existingNodes.length % 3) * 240,
        y: 480 + (existingNodes.length % 2) * 120,
      },
    );
  }

  return null;
}

/**
 * Simulates the synchronization logic between parent initialGraph,
 * canvas user edits, and lastEmittedGraphRef in NodePreview.
 */
class CanvasSyncController {
  nodes: WorkflowFlowNode[];
  isCanvasUserEdited = false;
  lastEmittedGraph: WorkflowGraph | null = null;
  prevInitialGraph: WorkflowGraph | null = null;
  prevWorkflowId: string | undefined = undefined;

  constructor(initialGraph: WorkflowGraph | null, workflowId?: string) {
    this.prevInitialGraph = initialGraph;
    this.prevWorkflowId = workflowId;
    this.nodes = initialGraph
      ? initialGraph.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: { ...n.data, type: n.type, label: n.data.label },
        }))
      : [
          createTriggerNode("trigger-1", { x: 250, y: 50 }),
          createConditionNode("condition-1", { x: 250, y: 180 }),
        ];
  }

  getCurrentPayload(): WorkflowGraph {
    return {
      version: 1,
      nodes: this.nodes.map((node) => ({
        id: node.id,
        type: node.type as WorkflowNodeType,
        position: node.position,
        data: {
          ...node.data,
          type: node.type as WorkflowNodeType,
          label: node.data.label,
        },
      })),
      edges: [],
    };
  }

  onDropNode(type: WorkflowNodeType, position: { x: number; y: number }) {
    const newNode = simulateCreateNode(this.nodes, type, position);
    if (!newNode) return;
    this.isCanvasUserEdited = true;
    this.nodes = [...this.nodes, newNode];
  }

  emitToParent(): WorkflowGraph | null {
    if (!this.isCanvasUserEdited) return null;
    const payload = this.getCurrentPayload();
    this.lastEmittedGraph = payload;
    return payload;
  }

  receiveParentUpdate(nextInitialGraph: WorkflowGraph | null, nextWorkflowId?: string) {
    const isWorkflowChanged = nextWorkflowId !== this.prevWorkflowId;
    const isExternalGraphChange =
      nextInitialGraph !== this.prevInitialGraph &&
      nextInitialGraph !== this.lastEmittedGraph;

    if (isWorkflowChanged || isExternalGraphChange) {
      this.prevWorkflowId = nextWorkflowId;
      this.prevInitialGraph = nextInitialGraph;
      this.isCanvasUserEdited = false;
      this.nodes = nextInitialGraph
        ? nextInitialGraph.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            position: n.position,
            data: { ...n.data, type: n.type, label: n.data.label },
          }))
        : [];
    } else {
      this.prevWorkflowId = nextWorkflowId;
      this.prevInitialGraph = nextInitialGraph;
    }
  }
}

describe("canvas node drag-and-drop and graph synchronization", () => {
  it("adds a node through drag-and-drop with specific coordinates and unique ID", () => {
    const controller = new CanvasSyncController(null, "wf-1");
    const initialCount = controller.nodes.length;

    controller.onDropNode("task", { x: 320, y: 400 });

    assert.equal(controller.nodes.length, initialCount + 1);
    const addedNode = controller.nodes[controller.nodes.length - 1];
    assert.equal(addedNode.type, "task");
    assert.deepEqual(addedNode.position, { x: 320, y: 400 });
    assert.equal(controller.isCanvasUserEdited, true);
  });

  it("prevents adding a second trigger node through drag-and-drop", () => {
    const controller = new CanvasSyncController(null, "wf-1");
    const initialCount = controller.nodes.length;
    assert.ok(controller.nodes.some((n) => n.type === "trigger"));

    controller.onDropNode("trigger", { x: 100, y: 100 });
    assert.equal(controller.nodes.length, initialCount);
  });

  it("keeps the newly dropped node after parent graph synchronization (prevents echo overwrite)", () => {
    const controller = new CanvasSyncController(null, "wf-1");

    // 1. Drop a new task node
    controller.onDropNode("task", { x: 500, y: 600 });
    const droppedNodeId = controller.nodes[controller.nodes.length - 1].id;

    // 2. Canvas emits payload to parent App
    const emittedPayload = controller.emitToParent();
    assert.ok(emittedPayload);
    assert.ok(emittedPayload.nodes.some((n) => n.id === droppedNodeId));

    // 3. Parent echoes back the emitted graph as next initialGraph
    controller.receiveParentUpdate(emittedPayload, "wf-1");

    // 4. Verify node is NOT lost, overwritten, or reset
    assert.ok(controller.nodes.some((n) => n.id === droppedNodeId));
    assert.equal(controller.isCanvasUserEdited, true);
  });

  it("preserves the dropped node when switching editor modes between canvas and wizard", () => {
    const initialGraph: WorkflowGraph = {
      version: 1,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          position: { x: 250, y: 50 },
          data: { type: "trigger", label: "Webhook trigger" },
        },
        {
          id: "task-1",
          type: "task",
          position: { x: 250, y: 190 },
          data: {
            type: "task",
            label: "Send confirmation",
            config: {
              type: "sendEmail",
              to: "user@example.com",
              subject: "Confirmed",
            },
          },
        },
      ],
      edges: [
        {
          id: "e1",
          source: "trigger-1",
          target: "task-1",
        },
      ],
    };

    const controller = new CanvasSyncController(initialGraph, "wf-1");

    // Drop an additional task node on the canvas
    controller.onDropNode("task", { x: 400, y: 350 });
    const canvasPayload = controller.getCurrentPayload();
    assert.equal(canvasPayload.nodes.length, 3);

    // Switch to Guided Wizard mode: parse the canvas payload
    const wizardState = parseGraphToWizardState(canvasPayload);
    // Wizard state preserves both the connected task and the newly added task step
    assert.ok(
      wizardState.steps.some(
        (s) => s.type === "task" && s.id === "task-1",
      ),
    );
    assert.ok(
      wizardState.steps.some(
        (s) => s.type === "task" && s.id.startsWith("task-"),
      ),
    );

    // Rebuild canonical graph from wizard
    const reconstructedGraph = buildCanonicalGraphFromWizard(wizardState);
    assert.ok(
      reconstructedGraph.nodes.some((n) => n.id === "task-1"),
    );
    assert.equal(reconstructedGraph.nodes.length >= 3, true);
  });

  it("saves and reloads the workflow without losing newly dropped nodes", () => {
    const baseGraph: WorkflowGraph = {
      version: 1,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          position: { x: 250, y: 50 },
          data: { type: "trigger", label: "Start" },
        },
      ],
      edges: [],
    };

    const controller = new CanvasSyncController(baseGraph, "wf-save-test");
    controller.onDropNode("task", { x: 300, y: 250 });
    controller.onDropNode("condition", { x: 300, y: 450 });

    const savedPayload = controller.getCurrentPayload();
    assert.equal(savedPayload.nodes.length, 3);

    // Simulate saving to backend and mapping response
    const persistedRecord = {
      _id: "persisted-wf-123",
      name: "Persisted Workflow",
      status: "Active" as const,
      version: 1,
      graph: savedPayload,
    };

    const mapped = mapPersistedWorkflow(persistedRecord);
    assert.equal(mapped.isPersisted, true);
    assert.equal(mapped.graph?.nodes.length, 3);
    assert.ok(mapped.graph?.nodes.some((n) => n.type === "trigger"));
    assert.ok(mapped.graph?.nodes.some((n) => n.type === "task"));
    assert.ok(mapped.graph?.nodes.some((n) => n.type === "condition"));
  });

  it("updates the editor when a genuinely different workflow is loaded", () => {
    const initialGraph: WorkflowGraph = {
      version: 1,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          position: { x: 250, y: 50 },
          data: { type: "trigger", label: "Initial workflow trigger" },
        },
      ],
      edges: [],
    };

    const controller = new CanvasSyncController(initialGraph, "wf-1");
    assert.equal(controller.nodes[0].data.label, "Initial workflow trigger");

    // Genuinely different workflow loaded from backend
    const differentWorkflowGraph: WorkflowGraph = {
      version: 1,
      nodes: [
        {
          id: "trigger-99",
          type: "trigger",
          position: { x: 100, y: 100 },
          data: { type: "trigger", label: "Different workflow trigger" },
        },
        {
          id: "task-99",
          type: "task",
          position: { x: 100, y: 300 },
          data: { type: "task", label: "Different task" },
        },
      ],
      edges: [
        { id: "e99", source: "trigger-99", target: "task-99" },
      ],
    };

    controller.receiveParentUpdate(differentWorkflowGraph, "wf-2");

    assert.equal(controller.nodes.length, 2);
    assert.equal(controller.nodes[0].id, "trigger-99");
    assert.equal(controller.nodes[0].data.label, "Different workflow trigger");
    assert.equal(controller.nodes[1].id, "task-99");
    assert.equal(controller.isCanvasUserEdited, false);
  });
});

