import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCanonicalGraphFromWizard,
  createDefaultCondition,
  createDefaultTask,
  createDefaultWizardState,
  parseGraphToWizardState,
  validateWizardState,
  type WizardState,
} from "../src/components/workflow/wizard/wizardState";
import { validateWorkflowGraph } from "../src/graphValidation";

describe("wizard state and canonical graph generation", () => {
  it("initializes a valid default wizard state", () => {
    const state = createDefaultWizardState("Test Order Flow", "Handles new customer orders");

    assert.equal(state.currentStepIndex, 0);
    assert.equal(state.name, "Test Order Flow");
    assert.equal(state.description, "Handles new customer orders");
    assert.equal(state.trigger.kind, "event");
    assert.equal(state.trigger.source, "business_events");
    assert.equal(state.trigger.eventName, "order.created");
    assert.equal(state.steps.length, 1);
    assert.equal(state.steps[0].type, "condition");

    const standaloneCondition = createDefaultCondition("cond-standalone", "Check VIP");
    assert.equal(standaloneCondition.id, "cond-standalone");
    assert.equal(standaloneCondition.trueTarget.label, "Charge payment");
    assert.equal(standaloneCondition.falseTarget.label, "Send review alert");
  });

  it("builds a canonical graph that passes all contract validation rules", () => {
    const state = createDefaultWizardState("Canonical Test");
    const graph = buildCanonicalGraphFromWizard(state);

    assert.equal(graph.version, 1);
    assert.equal(Array.isArray(graph.nodes), true);
    assert.equal(Array.isArray(graph.edges), true);

    // Exactly one trigger
    const triggers = graph.nodes.filter((n) => n.type === "trigger");
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0].data.type, "trigger");
    assert.equal(typeof triggers[0].position.x, "number");
    assert.equal(typeof triggers[0].position.y, "number");

    // Condition node has both required true and false handles
    const condition = graph.nodes.find((n) => n.type === "condition");
    assert.ok(condition);

    const trueEdge = graph.edges.find(
      (e) => e.source === condition?.id && e.sourceHandle === "true",
    );
    const falseEdge = graph.edges.find(
      (e) => e.source === condition?.id && e.sourceHandle === "false",
    );

    assert.ok(trueEdge, "Missing edge with sourceHandle true");
    assert.ok(falseEdge, "Missing edge with sourceHandle false");

    // Targets must exist in nodes array
    assert.ok(graph.nodes.some((n) => n.id === trueEdge?.target));
    assert.ok(graph.nodes.some((n) => n.id === falseEdge?.target));

    // Must satisfy pure graph validation with zero errors
    const errors = validateWorkflowGraph(graph);
    assert.deepEqual(errors, []);
  });

  it("supports linear task workflows without conditions", () => {
    const state: WizardState = {
      currentStepIndex: 0,
      name: "Linear Flow",
      description: "Simple task sequence",
      trigger: {
        id: "trigger-1",
        label: "Schedule trigger",
        kind: "schedule",
        source: "business_events",
        eventName: "",
        cron: "0 9 * * 1-5",
        timezone: "UTC",
        webhookMethod: "POST",
        webhookPath: "/api/v1/webhook",
      },
      steps: [
        createDefaultTask("task-1", "Fetch daily reports", "http"),
        createDefaultTask("task-2", "Email team summary", "sendEmail"),
      ],
    };

    const graph = buildCanonicalGraphFromWizard(state);
    assert.equal(graph.nodes.length, 3);
    assert.equal(graph.edges.length, 2);

    const errors = validateWorkflowGraph(graph);
    assert.deepEqual(errors, []);
  });

  it("validates wizard inputs and returns actionable step-indexed errors", () => {
    const invalidState: WizardState = {
      currentStepIndex: 0,
      name: "   ", // Empty name
      description: "x".repeat(2001), // Too long
      trigger: {
        id: "trigger-1",
        label: "Event",
        kind: "event",
        source: "business_events",
        eventName: "   ", // Empty event name
        cron: "",
        timezone: "",
        webhookMethod: "POST",
        webhookPath: "",
      },
      steps: [], // No steps
    };

    const errors = validateWizardState(invalidState);
    assert.ok(errors.some((e) => e.step === 0 && e.field === "name"));
    assert.ok(errors.some((e) => e.step === 0 && e.field === "description"));
    assert.ok(errors.some((e) => e.step === 1 && e.field === "trigger.eventName"));
    assert.ok(errors.some((e) => e.step === 2));
  });

  it("preserves graph data and semantics across round trips", () => {
    const originalState = createDefaultWizardState("Roundtrip Order Flow");
    const canonicalGraph = buildCanonicalGraphFromWizard(originalState);

    const parsedState = parseGraphToWizardState(
      canonicalGraph,
      "Roundtrip Order Flow",
      "Preserved description",
    );

    assert.equal(parsedState.name, "Roundtrip Order Flow");
    assert.equal(parsedState.description, "Preserved description");
    assert.equal(parsedState.trigger.kind, "event");
    assert.equal(parsedState.trigger.eventName, "order.created");
    assert.equal(parsedState.steps.length, 1);
    assert.equal(parsedState.steps[0].type, "condition");

    // Synthesize back to canonical graph
    const secondGraph = buildCanonicalGraphFromWizard(parsedState);
    assert.deepEqual(validateWorkflowGraph(secondGraph), []);
    assert.equal(secondGraph.nodes.length, canonicalGraph.nodes.length);
    assert.equal(secondGraph.edges.length, canonicalGraph.edges.length);
  });

  it("passes wizard metadata including name and description on workflow creation", () => {
    const wizardState = createDefaultWizardState("New Custom Workflow", "Custom workflow description");
    const canonicalGraph = buildCanonicalGraphFromWizard(wizardState);

    assert.equal(wizardState.name, "New Custom Workflow");
    assert.equal(wizardState.description, "Custom workflow description");
    assert.equal(validateWizardState(wizardState).length, 0);
    assert.equal(validateWorkflowGraph(canonicalGraph).length, 0);
  });
});
