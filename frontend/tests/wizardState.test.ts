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

  it("regression: preserves all supported task types and custom configurations across parse and rebuild", () => {
    // 1. HTTP task
    const httpGraph: WorkflowGraph = {
      version: 1,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          position: { x: 250, y: 50 },
          data: { label: "Trigger", type: "trigger", config: { kind: "event", source: "business_events", eventName: "test.event" } },
        },
        {
          id: "task-http",
          type: "task",
          position: { x: 250, y: 180 },
          data: {
            label: "Custom HTTP",
            type: "task",
            config: { action: "http", method: "PUT", url: "https://api.acme.corp/v2/webhook" },
          },
        },
      ],
      edges: [{ id: "edge-1", source: "trigger-1", target: "task-http" }],
    };

    const parsedHttp = parseGraphToWizardState(httpGraph, "HTTP Flow");
    assert.equal(parsedHttp.steps.length, 1);
    const httpStep = parsedHttp.steps[0];
    assert.equal(httpStep.type, "task");
    if (httpStep.type === "task") {
      assert.equal(httpStep.action, "http");
      assert.equal(httpStep.httpMethod, "PUT");
      assert.equal(httpStep.httpUrl, "https://api.acme.corp/v2/webhook");
    }
    const rebuiltHttpGraph = buildCanonicalGraphFromWizard(parsedHttp);
    const rebuiltHttpNode = rebuiltHttpGraph.nodes.find((n) => n.id === "task-http");
    assert.deepEqual(rebuiltHttpNode?.data?.config, {
      action: "http",
      method: "PUT",
      url: "https://api.acme.corp/v2/webhook",
    });

    // 2. sendEmail task
    const emailGraph: WorkflowGraph = {
      version: 1,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          position: { x: 250, y: 50 },
          data: { label: "Trigger", type: "trigger", config: { kind: "event", source: "business_events", eventName: "test.event" } },
        },
        {
          id: "task-email",
          type: "task",
          position: { x: 250, y: 180 },
          data: {
            label: "Notify Finance",
            type: "task",
            config: {
              action: "sendEmail",
              to: "finance@acme.corp",
              subject: "Receipt Ready #1234",
              body: "Please find attached receipt.",
            },
          },
        },
      ],
      edges: [{ id: "edge-1", source: "trigger-1", target: "task-email" }],
    };

    const parsedEmail = parseGraphToWizardState(emailGraph, "Email Flow");
    assert.equal(parsedEmail.steps.length, 1);
    const emailStep = parsedEmail.steps[0];
    assert.equal(emailStep.type, "task");
    if (emailStep.type === "task") {
      assert.equal(emailStep.action, "sendEmail");
      assert.equal(emailStep.emailTo, "finance@acme.corp");
      assert.equal(emailStep.emailSubject, "Receipt Ready #1234");
      assert.equal(emailStep.emailBody, "Please find attached receipt.");
    }
    const rebuiltEmailGraph = buildCanonicalGraphFromWizard(parsedEmail);
    const rebuiltEmailNode = rebuiltEmailGraph.nodes.find((n) => n.id === "task-email");
    assert.deepEqual(rebuiltEmailNode?.data?.config, {
      action: "sendEmail",
      to: "finance@acme.corp",
      subject: "Receipt Ready #1234",
      body: "Please find attached receipt.",
    });

    // 3. sendSlack task
    const slackGraph: WorkflowGraph = {
      version: 1,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          position: { x: 250, y: 50 },
          data: { label: "Trigger", type: "trigger", config: { kind: "event", source: "business_events", eventName: "test.event" } },
        },
        {
          id: "task-slack",
          type: "task",
          position: { x: 250, y: 180 },
          data: {
            label: "Slack Alert",
            type: "task",
            config: { action: "sendSlack", channel: "#alerts-prod", message: "Deployment started" },
          },
        },
      ],
      edges: [{ id: "edge-1", source: "trigger-1", target: "task-slack" }],
    };

    const parsedSlack = parseGraphToWizardState(slackGraph, "Slack Flow");
    const slackStep = parsedSlack.steps[0];
    assert.equal(slackStep.type, "task");
    if (slackStep.type === "task") {
      assert.equal(slackStep.action, "sendSlack");
      assert.equal(slackStep.slackChannel, "#alerts-prod");
      assert.equal(slackStep.slackMessage, "Deployment started");
    }
    const rebuiltSlackGraph = buildCanonicalGraphFromWizard(parsedSlack);
    const rebuiltSlackNode = rebuiltSlackGraph.nodes.find((n) => n.id === "task-slack");
    assert.deepEqual(rebuiltSlackNode?.data?.config, {
      action: "sendSlack",
      channel: "#alerts-prod",
      message: "Deployment started",
    });

    // 4. dbQuery task
    const dbGraph: WorkflowGraph = {
      version: 1,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          position: { x: 250, y: 50 },
          data: { label: "Trigger", type: "trigger", config: { kind: "event", source: "business_events", eventName: "test.event" } },
        },
        {
          id: "task-db",
          type: "task",
          position: { x: 250, y: 180 },
          data: {
            label: "Query Analytics",
            type: "task",
            config: { action: "dbQuery", connection: "analytics-replica", query: "SELECT count(*) FROM users" },
          },
        },
      ],
      edges: [{ id: "edge-1", source: "trigger-1", target: "task-db" }],
    };

    const parsedDb = parseGraphToWizardState(dbGraph, "DB Flow");
    const dbStep = parsedDb.steps[0];
    assert.equal(dbStep.type, "task");
    if (dbStep.type === "task") {
      assert.equal(dbStep.action, "dbQuery");
      assert.equal(dbStep.dbConnection, "analytics-replica");
      assert.equal(dbStep.dbQuery, "SELECT count(*) FROM users");
    }
    const rebuiltDbGraph = buildCanonicalGraphFromWizard(parsedDb);
    const rebuiltDbNode = rebuiltDbGraph.nodes.find((n) => n.id === "task-db");
    assert.deepEqual(rebuiltDbNode?.data?.config, {
      action: "dbQuery",
      connection: "analytics-replica",
      query: "SELECT count(*) FROM users",
    });

    // 5. transform task
    const transformGraph: WorkflowGraph = {
      version: 1,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          position: { x: 250, y: 50 },
          data: { label: "Trigger", type: "trigger", config: { kind: "event", source: "business_events", eventName: "test.event" } },
        },
        {
          id: "task-transform",
          type: "task",
          position: { x: 250, y: 180 },
          data: {
            label: "Transform Payload",
            type: "task",
            config: { action: "transform", expression: "input.items.map(x => x.id)" },
          },
        },
      ],
      edges: [{ id: "edge-1", source: "trigger-1", target: "task-transform" }],
    };

    const parsedTransform = parseGraphToWizardState(transformGraph, "Transform Flow");
    const transformStep = parsedTransform.steps[0];
    assert.equal(transformStep.type, "task");
    if (transformStep.type === "task") {
      assert.equal(transformStep.action, "transform");
      assert.equal(transformStep.transformExpression, "input.items.map(x => x.id)");
    }
    const rebuiltTransformGraph = buildCanonicalGraphFromWizard(parsedTransform);
    const rebuiltTransformNode = rebuiltTransformGraph.nodes.find((n) => n.id === "task-transform");
    assert.deepEqual(rebuiltTransformNode?.data?.config, {
      action: "transform",
      expression: "input.items.map(x => x.id)",
    });
  });

  it("regression: preserves condition branch task configurations and condition operands", () => {
    const conditionGraph: WorkflowGraph = {
      version: 1,
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          position: { x: 250, y: 50 },
          data: { label: "Trigger", type: "trigger", config: { kind: "event", source: "business_events", eventName: "order.created" } },
        },
        {
          id: "cond-1",
          type: "condition",
          position: { x: 250, y: 180 },
          data: {
            label: "Is High Priority?",
            type: "condition",
            config: {
              type: "clause",
              clause: { left: "order.priority", op: "equals", right: "high" },
            },
          },
        },
        {
          id: "task-true",
          type: "task",
          position: { x: 80, y: 330 },
          data: {
            label: "Slack Escalation",
            type: "task",
            config: { action: "sendSlack", channel: "#urgent-ops", message: "High priority order incoming" },
          },
        },
        {
          id: "task-false",
          type: "task",
          position: { x: 420, y: 330 },
          data: {
            label: "Log to Database",
            type: "task",
            config: { action: "dbQuery", connection: "warehouse-db", query: "INSERT INTO standard_orders VALUES (1)" },
          },
        },
      ],
      edges: [
        { id: "edge-1", source: "trigger-1", target: "cond-1" },
        { id: "edge-2", source: "cond-1", sourceHandle: "true", target: "task-true" },
        { id: "edge-3", source: "cond-1", sourceHandle: "false", target: "task-false" },
      ],
    };

    const parsed = parseGraphToWizardState(conditionGraph, "Branch Flow");
    assert.equal(parsed.steps.length, 1);
    const condStep = parsed.steps[0];
    assert.equal(condStep.type, "condition");
    if (condStep.type === "condition") {
      assert.equal(condStep.label, "Is High Priority?");
      assert.equal(condStep.left, "order.priority");
      assert.equal(condStep.op, "equals");
      assert.equal(condStep.right, "high");
      assert.equal(condStep.trueTarget.action, "sendSlack");
      assert.equal(condStep.trueTarget.slackChannel, "#urgent-ops");
      assert.equal(condStep.falseTarget.action, "dbQuery");
      assert.equal(condStep.falseTarget.dbConnection, "warehouse-db");
    }

    const rebuilt = buildCanonicalGraphFromWizard(parsed);
    const trueNode = rebuilt.nodes.find((n) => n.id === "task-true");
    const falseNode = rebuilt.nodes.find((n) => n.id === "task-false");
    assert.deepEqual(trueNode?.data?.config, {
      action: "sendSlack",
      channel: "#urgent-ops",
      message: "High priority order incoming",
    });
    assert.deepEqual(falseNode?.data?.config, {
      action: "dbQuery",
      connection: "warehouse-db",
      query: "INSERT INTO standard_orders VALUES (1)",
    });
  });

  it("regression: correctly handles falsy, zero, empty, and truthy condition values", () => {
    // 1. Boolean false
    const boolFalseGraph: WorkflowGraph = {
      version: 1,
      nodes: [
        { id: "t1", type: "trigger", position: { x: 0, y: 0 }, data: { label: "T", type: "trigger" } },
        {
          id: "c1",
          type: "condition",
          position: { x: 0, y: 100 },
          data: {
            label: "Check Inactive",
            type: "condition",
            config: { type: "clause", clause: { left: "isActive", op: "equals", right: false } },
          },
        },
        { id: "task-t", type: "task", position: { x: 0, y: 200 }, data: { label: "T1", type: "task" } },
        { id: "task-f", type: "task", position: { x: 100, y: 200 }, data: { label: "T2", type: "task" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "c1" },
        { id: "e2", source: "c1", sourceHandle: "true", target: "task-t" },
        { id: "e3", source: "c1", sourceHandle: "false", target: "task-f" },
      ],
    };

    const parsedBool = parseGraphToWizardState(boolFalseGraph);
    const condStep1 = parsedBool.steps[0];
    if (condStep1.type === "condition") {
      assert.strictEqual(condStep1.right, false);
      assert.strictEqual(condStep1.rawValue, "false");
      assert.strictEqual(condStep1.valueType, "boolean");
    }

    // 2. Number 0
    const zeroGraph: WorkflowGraph = {
      ...boolFalseGraph,
      nodes: boolFalseGraph.nodes.map((n) =>
        n.id === "c1"
          ? {
              ...n,
              data: {
                ...n.data,
                config: { type: "clause", clause: { left: "retries", op: "greaterThan", right: 0 } },
              },
            }
          : n,
      ),
    };

    const parsedZero = parseGraphToWizardState(zeroGraph);
    const condStep2 = parsedZero.steps[0];
    if (condStep2.type === "condition") {
      assert.strictEqual(condStep2.right, 0);
      assert.strictEqual(condStep2.rawValue, "0");
      assert.strictEqual(condStep2.valueType, "number");
    }

    // 3. Empty string ""
    const emptyStringGraph: WorkflowGraph = {
      ...boolFalseGraph,
      nodes: boolFalseGraph.nodes.map((n) =>
        n.id === "c1"
          ? {
              ...n,
              data: {
                ...n.data,
                config: { type: "clause", clause: { left: "middleName", op: "equals", right: "" } },
              },
            }
          : n,
      ),
    };

    const parsedEmpty = parseGraphToWizardState(emptyStringGraph);
    const condStep3 = parsedEmpty.steps[0];
    if (condStep3.type === "condition") {
      assert.strictEqual(condStep3.right, "");
      assert.strictEqual(condStep3.rawValue, "");
      assert.strictEqual(condStep3.valueType, "string");
    }

    // 4. Operator "truthy" (no right-hand value)
    const truthyGraph: WorkflowGraph = {
      ...boolFalseGraph,
      nodes: boolFalseGraph.nodes.map((n) =>
        n.id === "c1"
          ? {
              ...n,
              data: {
                ...n.data,
                config: { type: "clause", clause: { left: "user.isVerified", op: "truthy" } },
              },
            }
          : n,
      ),
    };

    const parsedTruthy = parseGraphToWizardState(truthyGraph);
    const condStep4 = parsedTruthy.steps[0];
    if (condStep4.type === "condition") {
      assert.strictEqual(condStep4.op, "truthy");
      assert.strictEqual(condStep4.right, undefined);
      assert.strictEqual(condStep4.rawValue, "");
    }
    const rebuiltTruthy = buildCanonicalGraphFromWizard(parsedTruthy);
    const rebuiltCondNode = rebuiltTruthy.nodes.find((n) => n.id === "c1");
    assert.deepEqual(rebuiltCondNode?.data?.config, {
      type: "clause",
      clause: { left: "user.isVerified", op: "truthy", right: undefined },
    });
  });

  it("regression: provides safe defaults for missing optional task fields without overwriting existing fields", () => {
    const partialTaskGraph: WorkflowGraph = {
      version: 1,
      nodes: [
        { id: "t1", type: "trigger", position: { x: 0, y: 0 }, data: { label: "T", type: "trigger" } },
        {
          id: "task-partial",
          type: "task",
          position: { x: 0, y: 100 },
          data: {
            label: "Partial Email",
            type: "task",
            config: {
              action: "sendEmail",
              to: "recipient@test.com",
              // subject and body intentionally omitted
            },
          },
        },
      ],
      edges: [{ id: "e1", source: "t1", target: "task-partial" }],
    };

    const parsed = parseGraphToWizardState(partialTaskGraph);
    const step = parsed.steps[0];
    if (step.type === "task") {
      assert.equal(step.action, "sendEmail");
      assert.equal(step.emailTo, "recipient@test.com");
      // Subject and body receive non-empty safe defaults
      assert.equal(step.emailSubject, "Workflow notification");
      assert.equal(step.emailBody, "A workflow step has completed.");
    }
  });

  it("regression: updates wizard state when workflow graph changes", () => {
    // Start with graph 1 (linear task)
    const graph1: WorkflowGraph = {
      version: 1,
      nodes: [
        { id: "t1", type: "trigger", position: { x: 0, y: 0 }, data: { label: "T", type: "trigger" } },
        { id: "task-1", type: "task", position: { x: 0, y: 100 }, data: { label: "Task 1", type: "task", config: { action: "http" } } },
      ],
      edges: [{ id: "e1", source: "t1", target: "task-1" }],
    };
    const state1 = parseGraphToWizardState(graph1, "Flow 1");
    assert.equal(state1.steps.length, 1);
    assert.equal(state1.steps[0].type, "task");

    // Later updated to graph 2 (condition workflow)
    const graph2: WorkflowGraph = {
      version: 1,
      nodes: [
        { id: "t1", type: "trigger", position: { x: 0, y: 0 }, data: { label: "T", type: "trigger" } },
        {
          id: "c1",
          type: "condition",
          position: { x: 0, y: 100 },
          data: { label: "Cond", type: "condition", config: { type: "clause", clause: { left: "ok", op: "truthy" } } },
        },
        { id: "task-t", type: "task", position: { x: 0, y: 200 }, data: { label: "T1", type: "task" } },
        { id: "task-f", type: "task", position: { x: 100, y: 200 }, data: { label: "T2", type: "task" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "c1" },
        { id: "e2", source: "c1", sourceHandle: "true", target: "task-t" },
        { id: "e3", source: "c1", sourceHandle: "false", target: "task-f" },
      ],
    };
    const state2 = parseGraphToWizardState(graph2, "Flow 2");
    assert.equal(state2.steps.length, 1);
    assert.equal(state2.steps[0].type, "condition");
    assert.equal(state2.name, "Flow 2");
  });

  it("regression: does not remove nodes when opening workflows with both tasks and conditions", () => {
    // 6-node workflow: Trigger -> Task 1 -> Condition 1 (True: Task 2, False: Task 3) -> Task 4
    const multiNodeGraph: WorkflowGraph = {
      version: 1,
      nodes: [
        { id: "t1", type: "trigger", position: { x: 250, y: 50 }, data: { label: "Trigger", type: "trigger" } },
        { id: "task-pre", type: "task", position: { x: 250, y: 180 }, data: { label: "Pre-task", type: "task", config: { action: "http" } } },
        {
          id: "c1",
          type: "condition",
          position: { x: 250, y: 320 },
          data: { label: "Check status", type: "condition", config: { type: "clause", clause: { left: "status", op: "equals", right: "active" } } },
        },
        { id: "task-true", type: "task", position: { x: 80, y: 470 }, data: { label: "True action", type: "task", config: { action: "sendEmail" } } },
        { id: "task-false", type: "task", position: { x: 420, y: 470 }, data: { label: "False action", type: "task", config: { action: "sendSlack" } } },
        { id: "task-post", type: "task", position: { x: 80, y: 620 }, data: { label: "Post-task", type: "task", config: { action: "dbQuery" } } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "task-pre" },
        { id: "e2", source: "task-pre", target: "c1" },
        { id: "e3", source: "c1", sourceHandle: "true", target: "task-true" },
        { id: "e4", source: "c1", sourceHandle: "false", target: "task-false" },
        { id: "e5", source: "task-true", target: "task-post" },
      ],
    };

    const wizardState = parseGraphToWizardState(multiNodeGraph, "Complex Multi-Node Workflow");

    // All steps must be preserved in wizard state
    assert.equal(wizardState.steps.length, 3, "Must preserve all 3 steps (task-pre, condition, task-post)");
    assert.equal(wizardState.steps[0].id, "task-pre");
    assert.equal(wizardState.steps[0].type, "task");
    assert.equal(wizardState.steps[1].id, "c1");
    assert.equal(wizardState.steps[1].type, "condition");
    if (wizardState.steps[1].type === "condition") {
      assert.equal(wizardState.steps[1].trueTarget.id, "task-true");
      assert.equal(wizardState.steps[1].falseTarget.id, "task-false");
    }
    assert.equal(wizardState.steps[2].id, "task-post");
    assert.equal(wizardState.steps[2].type, "task");

    // Rebuilding the graph must maintain all 6 nodes without removing any
    const rebuiltGraph = buildCanonicalGraphFromWizard(wizardState);
    assert.equal(rebuiltGraph.nodes.length, 6, "All 6 nodes must survive roundtrip");
    const nodeIds = rebuiltGraph.nodes.map((n) => n.id);
    assert.ok(nodeIds.includes("t1"));
    assert.ok(nodeIds.includes("task-pre"));
    assert.ok(nodeIds.includes("c1"));
    assert.ok(nodeIds.includes("task-true"));
    assert.ok(nodeIds.includes("task-false"));
    assert.ok(nodeIds.includes("task-post"));

    const errors = validateWorkflowGraph(rebuiltGraph);
    assert.deepEqual(errors, []);
  });

  it("regression: preserves multiple condition steps without dropping nodes", () => {
    // 7-node workflow: Trigger -> Condition 1 (True: Task 1, False: Task 2) -> Condition 2 (True: Task 3, False: Task 4)
    const twoConditionsGraph: WorkflowGraph = {
      version: 1,
      nodes: [
        { id: "t1", type: "trigger", position: { x: 250, y: 50 }, data: { label: "Trigger", type: "trigger" } },
        {
          id: "c1",
          type: "condition",
          position: { x: 250, y: 180 },
          data: { label: "Check 1", type: "condition", config: { type: "clause", clause: { left: "tier", op: "equals", right: "gold" } } },
        },
        { id: "task-1", type: "task", position: { x: 80, y: 330 }, data: { label: "Gold Action", type: "task" } },
        { id: "task-2", type: "task", position: { x: 420, y: 330 }, data: { label: "Non-gold Action", type: "task" } },
        {
          id: "c2",
          type: "condition",
          position: { x: 80, y: 480 },
          data: { label: "Check 2", type: "condition", config: { type: "clause", clause: { left: "verified", op: "truthy" } } },
        },
        { id: "task-3", type: "task", position: { x: 80, y: 630 }, data: { label: "Verified Action", type: "task" } },
        { id: "task-4", type: "task", position: { x: 420, y: 630 }, data: { label: "Unverified Action", type: "task" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "c1" },
        { id: "e2", source: "c1", sourceHandle: "true", target: "task-1" },
        { id: "e3", source: "c1", sourceHandle: "false", target: "task-2" },
        { id: "e4", source: "task-1", target: "c2" },
        { id: "e5", source: "c2", sourceHandle: "true", target: "task-3" },
        { id: "e6", source: "c2", sourceHandle: "false", target: "task-4" },
      ],
    };

    const wizardState = parseGraphToWizardState(twoConditionsGraph, "Two Conditions Flow");
    assert.equal(wizardState.steps.length, 2, "Both conditions must be present");
    assert.equal(wizardState.steps[0].id, "c1");
    assert.equal(wizardState.steps[1].id, "c2");

    const rebuiltGraph = buildCanonicalGraphFromWizard(wizardState);
    assert.equal(rebuiltGraph.nodes.length, 7, "All 7 nodes must survive roundtrip");
    const errors = validateWorkflowGraph(rebuiltGraph);
    assert.deepEqual(errors, []);
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
