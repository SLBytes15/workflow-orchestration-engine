import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendWorkflow,
  isRunButtonDisabled,
  mapPersistedWorkflow,
  mapPersistedWorkflows,
  mergeSavedWorkflows,
  removeWorkflow,
  type Workflow,
} from "../src/workflowState";
import {
  CONDITION_OPERATOR_LABELS,
  createConditionConfig,
  createConditionConfigFromInput,
  createConditionNode,
  getConditionConfigError,
  hasValidConditionConfig,
  MAX_NODE_LABEL_LENGTH,
  parseConditionValue,
  serializeWorkflowGraph,
  summarizeCondition,
  validateNodeLabel,
  withConditionConfig,
  withNodeLabel,
} from "../src/components/workflow/nodes/node.types";

const sampleWorkflow: Workflow = {
  id: "sample-id",
  isPersisted: false,
  name: "Sample",
  description: "Local sample",
  status: "Draft",
  version: 1,
  updatedAt: "2026-10-10",
};

describe("workflow persistence mapping", () => {
  it("marks records returned by the backend as persisted", () => {
    const workflow = mapPersistedWorkflow({
      _id: "6ad9a2f75b4a085ee3c2c266",
      name: "Saved",
      status: "Draft",
      version: 1,
    });

    assert.equal(workflow.id, "6ad9a2f75b4a085ee3c2c266");
    assert.equal(workflow.isPersisted, true);
  });

  it("preserves a saved workflow graph and does not fabricate missing config on load", () => {
    const conditionData = { type: "condition", label: "Legacy condition" };
    const graph = {
      version: 1 as const,
      nodes: [
        {
          id: "condition-1",
          type: "condition" as const,
          position: { x: 5, y: 10 },
          data: conditionData,
        },
      ],
      edges: [],
    };
    const workflow = mapPersistedWorkflow({
      id: "saved-id",
      name: "Saved graph",
      graph,
    });

    assert.deepEqual(workflow.graph, graph);
    assert.deepEqual(workflow.graph?.nodes[0].data, conditionData);
    assert.equal(
      mapPersistedWorkflow({
        id: "invalid-graph-id",
        name: "Invalid graph",
        graph: { version: 2, nodes: [], edges: [] },
      }).graph,
      undefined,
    );
  });

  it("keeps sample workflows non-persisted even when they have IDs", () => {
    const merged = mergeSavedWorkflows([sampleWorkflow], []);

    assert.equal(merged[0].id, "sample-id");
    assert.equal(merged[0].isPersisted, false);
  });

  it("maps a newly created workflow as persisted only from the returned record", () => {
    const workflow = mapPersistedWorkflow(
      {
        id: "6ad9a2f75b4a085ee3c2c266",
        name: "Created",
      },
      { name: "Created", description: "Saved description" },
    );

    assert.equal(workflow.isPersisted, true);
    assert.equal(workflow.description, "Saved description");
  });

  it("rejects unsuccessful or malformed creation results without changing state", () => {
    let current = [sampleWorkflow];

    assert.throws(() => {
      const created = mapPersistedWorkflow(undefined);
      current = appendWorkflow(current, created);
    });
    assert.throws(() => {
      const created = mapPersistedWorkflow({ name: "No ID" });
      current = appendWorkflow(current, created);
    });
    assert.deepEqual(current, [sampleWorkflow]);
  });

  it("leaves samples non-persisted when a saved-workflow load cannot be mapped", () => {
    let current = [sampleWorkflow];

    assert.throws(() => {
      const saved = mapPersistedWorkflows([
        { id: "6ad9a2f75b4a085ee3c2c266", name: "Saved" },
        { name: "Malformed response" },
      ]);
      current = mergeSavedWorkflows([sampleWorkflow], saved);
    });
    assert.deepEqual(current, [sampleWorkflow]);
    assert.equal(current[0].isPersisted, false);
  });

  it("disables the Run button for non-persisted or already-running workflows", () => {
    assert.equal(isRunButtonDisabled(false, false), true);
    assert.equal(isRunButtonDisabled(true, true), true);
    assert.equal(isRunButtonDisabled(true, false), false);

    const saved = mapPersistedWorkflow({
      id: "6ad9a2f75b4a085ee3c2c266",
      name: "Saved",
    });
    assert.deepEqual(appendWorkflow([], saved), [saved]);
  });
});

describe("condition configuration", () => {
  it("creates new condition nodes with the runtime-compatible default clause", () => {
    const node = createConditionNode("condition-1", { x: 0, y: 0 });

    assert.deepEqual(node.data.config, {
      type: "clause",
      clause: {
        left: "approved",
        op: "equals",
        right: true,
      },
    });

    assert.equal(hasValidConditionConfig(node.data), true);
  });

  it("reports missing config clearly without rewriting it during serialization", () => {
    const graph = {
      version: 1 as const,
      nodes: [
        {
          id: "condition-1",
          type: "condition" as const,
          position: { x: 0, y: 0 },
          data: { type: "condition" as const, label: "Legacy condition" },
        },
      ],
      edges: [],
    };

    assert.match(getConditionConfigError(graph) ?? "", /Legacy condition/);
    assert.equal(
      serializeWorkflowGraph(graph.nodes, graph.edges).nodes[0].data.config,
      undefined,
    );
  });

  it("preserves an edited condition config through serialization", () => {
    const original = createConditionNode("condition-1", { x: 0, y: 0 });
    const editedConfig = {
      type: "clause" as const,
      clause: {
        left: "approved",
        op: "equals" as const,
        right: false,
      },
    };
    const edited = withConditionConfig(original, editedConfig);
    const graph = serializeWorkflowGraph([edited], []);
    const reopened = mapPersistedWorkflow({
      id: "saved-id",
      name: "Saved graph",
      graph,
    });

    assert.deepEqual(graph.nodes[0].data.config, editedConfig);
    assert.deepEqual(graph.nodes[0].data.config, edited.data.config);
    assert.deepEqual(
      reopened.graph?.nodes[0].data.config,
      editedConfig,
    );
  });

  it("does not create a default config until the editor explicitly initializes it", () => {
    const legacyData = { type: "condition", label: "Existing condition" };

    assert.equal(hasValidConditionConfig(legacyData), false);
    assert.deepEqual(createConditionConfig().clause, {
      left: "approved",
      op: "equals",
      right: true,
    });
    assert.deepEqual(legacyData, {
      type: "condition",
      label: "Existing condition",
    });

    assert.equal(
      hasValidConditionConfig({
        config: {
          type: "clause",
          clause: { left: "approved", op: "matches", right: "true" },
        },
      }),
      false,
    );
  });

  it("maps friendly operator labels to the unchanged backend values", () => {
    assert.equal(CONDITION_OPERATOR_LABELS.equals, "Is equal to");
    assert.equal(CONDITION_OPERATOR_LABELS.notEquals, "Is not equal to");
    assert.equal(CONDITION_OPERATOR_LABELS.gt, "Is greater than");
    assert.equal(CONDITION_OPERATOR_LABELS.gte, "Is at least");
    assert.equal(CONDITION_OPERATOR_LABELS.lt, "Is less than");
    assert.equal(CONDITION_OPERATOR_LABELS.lte, "Is at most");
    assert.equal(CONDITION_OPERATOR_LABELS.contains, "Contains");
    assert.equal(CONDITION_OPERATOR_LABELS.startsWith, "Starts with");
    assert.equal(CONDITION_OPERATOR_LABELS.truthy, "Is present / truthy");
  });

  it("preserves boolean and numeric comparison types through saving and reload", () => {
    const booleanResult = createConditionConfigFromInput(
      "approved",
      "equals",
      "false",
      "boolean",
    );
    const numericResult = createConditionConfigFromInput(
      "order.total",
      "gte",
      "12.5",
      "number",
    );
    assert.equal(booleanResult.config?.clause.right, false);
    assert.equal(typeof booleanResult.config?.clause.right, "boolean");
    assert.equal(numericResult.config?.clause.right, 12.5);
    assert.equal(typeof numericResult.config?.clause.right, "number");

    const node = createConditionNode("condition-1", { x: 0, y: 0 });
    const edited = withConditionConfig(node, numericResult.config!);
    const graph = serializeWorkflowGraph([edited], []);
    const reopened = mapPersistedWorkflow({
      id: "saved-id",
      name: "Saved",
      graph,
    });
    assert.equal(reopened.graph?.nodes[0].data.config &&
      "clause" in reopened.graph.nodes[0].data.config
      ? reopened.graph.nodes[0].data.config.clause.right
      : undefined, 12.5);
  });

  it("parses only valid boolean text and rejects empty or invalid values", () => {
    assert.deepEqual(parseConditionValue("true", "boolean"), { value: true });
    assert.deepEqual(parseConditionValue("false", "boolean"), { value: false });
    assert.deepEqual(parseConditionValue(" true ", "boolean"), { value: true });
    assert.deepEqual(parseConditionValue("12x", "boolean"), {
      error: "Choose True or False for the comparison value.",
    });
    assert.deepEqual(parseConditionValue("", "boolean"), {
      error: "Enter a comparison value.",
    });
    assert.deepEqual(parseConditionValue("  ", "boolean"), {
      error: "Enter a comparison value.",
    });
    assert.equal(
      createConditionConfigFromInput(
        "approved",
        "equals",
        "12x",
        "boolean",
      ).error,
      "Choose True or False for the comparison value.",
    );
  });

  it("rejects missing paths and invalid required comparison values", () => {
    assert.equal(
      createConditionConfigFromInput("", "equals", "true", "boolean").error,
      "Enter what you want to check.",
    );
    assert.equal(
      createConditionConfigFromInput("approved", "equals", "", "boolean").error,
      "Enter a comparison value.",
    );
    assert.equal(
      createConditionConfigFromInput("order.total", "gt", "12x", "number").error,
      "Enter a valid number.",
    );
    assert.equal(parseConditionValue("not-json", "json").error, "Enter a valid JSON value.");
  });

  it("summarizes configured conditions in plain English", () => {
    assert.equal(
      summarizeCondition({
        left: "approved",
        op: "equals",
        right: true,
      }),
      "If approved is equal to true",
    );
    assert.equal(
      summarizeCondition({ left: "approved", op: "truthy" }),
      "If approved is present / truthy",
    );
  });
});

describe("workflow node labels", () => {
  it("trims and validates labels using the workflow name length limit", () => {
    assert.equal(validateNodeLabel("  Capture payment  "), null);
    assert.equal(validateNodeLabel("   "), "Node label must not be empty.");
    assert.match(
      validateNodeLabel("x".repeat(MAX_NODE_LABEL_LENGTH + 1)) ?? "",
      /120 characters or fewer/,
    );
  });

  it("renames a node without changing its identity, configuration, position, or edges", () => {
    const condition = createConditionNode("condition-1", { x: 25, y: 40 });
    const original = {
      ...condition,
      data: { ...condition.data, customMetadata: { source: "editor" } },
    };
    const edges = [
      {
        id: "true-edge",
        source: "condition-1",
        target: "task-1",
        sourceHandle: "true",
        targetHandle: undefined,
      },
      {
        id: "false-edge",
        source: "condition-1",
        target: "task-2",
        sourceHandle: "false",
        targetHandle: undefined,
      },
    ];
    const renamed = withNodeLabel(original, " Payment approved ");

    assert.equal(renamed.id, "condition-1");
    assert.equal(renamed.type, "condition");
    assert.deepEqual(renamed.position, { x: 25, y: 40 });
    assert.equal(renamed.data.label, "Payment approved");
    assert.deepEqual(renamed.data.config, original.data.config);
    assert.deepEqual(renamed.data.customMetadata, { source: "editor" });

    const graph = serializeWorkflowGraph([renamed], edges);
    assert.equal(graph.nodes[0].data.label, "Payment approved");
    assert.deepEqual(graph.nodes[0].data.config, original.data.config);
    assert.deepEqual(graph.edges, edges);
    assert.equal(original.data.label, "Condition");
  });

  it("removes only the deleted workflow from frontend list state", () => {
    const saved = mapPersistedWorkflow({
      id: "saved-id",
      name: "Saved",
    });
    assert.deepEqual(removeWorkflow([sampleWorkflow, saved], "saved-id"), [
      sampleWorkflow,
    ]);
    assert.deepEqual(removeWorkflow([sampleWorkflow, saved], "unknown"), [
      sampleWorkflow,
      saved,
    ]);
  });
});
