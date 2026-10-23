
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import TriggerNode from "./TriggerNode";
import TaskNode from "./TaskNode";
import ConditionNode from "./ConditionNode";
import type { WorkflowGraph } from "../../../api/workflowApi";
import {
  CONDITION_OPERATOR_LABELS,
  createConditionConfig,
  createConditionConfigFromInput,
  createConditionNode,
  getConditionValueType,
  getConditionConfigError,
  hasValidConditionConfig,
  parseConditionValue,
  serializeWorkflowGraph,
  summarizeCondition,
  validateNodeLabel,
  type ConditionConfig,
  type ConditionNodeData,
  type ConditionOp,
  type ConditionValueType,
  type WorkflowFlowNode,
  withConditionConfig,
  withNodeLabel,
} from "./node.types";

type NodePreviewProps = {
  workflowId?: string;
  workflowName?: string;
  initialGraph?: WorkflowGraph | null;
  onGraphChange?: (graph: WorkflowGraph) => void;
  onSaveGraph?: (graph: WorkflowGraph) => Promise<void>;
};

const initialNodes: Node[] = [
  {
    id: "trigger-1",
    type: "trigger",
    position: { x: 250, y: 50 },
    data: {
      type: "trigger",
      label: "Order created",
    },
  },
  {
    id: "condition-1",
    type: "condition",
    position: { x: 250, y: 180 },
    data: {
      type: "condition",
      label: "Order approved?",
      config: {
        type: "clause",
        clause: {
          left: "approved",
          op: "equals",
          right: true,
        },
      },
    },
  },
  {
    id: "task-1",
    type: "task",
    position: { x: 80, y: 330 },
    data: {
      type: "task",
      label: "Charge payment",
    },
  },
  {
    id: "task-2",
    type: "task",
    position: { x: 420, y: 330 },
    data: {
      type: "task",
      label: "Manual review",
    },
  },
];

const initialEdges: Edge[] = [
  {
    id: "edge-trigger-condition",
    source: "trigger-1",
    target: "condition-1",
  },
  {
    id: "edge-condition-true",
    source: "condition-1",
    sourceHandle: "true",
    target: "task-1",
    label: "True",
  },
  {
    id: "edge-condition-false",
    source: "condition-1",
    sourceHandle: "false",
    target: "task-2",
    label: "False",
  },
];

const nodeTypes = {
  trigger: TriggerNode,
  task: TaskNode,
  condition: ConditionNode,
};

const conditionOperators: ConditionOp[] = [
  "equals",
  "notEquals",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "startsWith",
  "truthy",
];

function valueToEditorText(
  value: unknown,
  valueType: ConditionValueType,
): string {
  if (valueType === "string") return typeof value === "string" ? value : "";
  if (valueType === "boolean") return String(value);
  if (valueType === "number") return String(value);
  return JSON.stringify(value) ?? "";
}

function clauseFromData(data: ConditionNodeData): ConditionConfig["clause"] | null {
  if (!hasValidConditionConfig(data)) return null;

  const config = data.config as ConditionConfig;
  return config.clause;
}

function ConditionConfigEditor({
  data,
  onApply,
}: {
  data: ConditionNodeData;
  onApply: (config: ConditionConfig) => void;
}) {
  const clause = clauseFromData(data);
  const [left, setLeft] = useState(clause?.left ?? "");
  const [op, setOp] = useState<ConditionOp>(clause?.op ?? "equals");
  const [rightValueType, setRightValueType] = useState<ConditionValueType>(
    clause && "right" in clause
      ? getConditionValueType(clause.right)
      : "boolean",
  );
  const [rightValue, setRightValue] = useState(
    clause && "right" in clause
      ? valueToEditorText(clause.right, getConditionValueType(clause.right))
      : "true",
  );
  const [error, setError] = useState("");

  function initializeDefault() {
    const config = createConditionConfig();
    setLeft(config.clause.left);
    setOp(config.clause.op);
    setRightValueType("boolean");
    setRightValue(String(config.clause.right));
    setError("");
    onApply(config);
  }

  function applyConfiguration() {
    const result = createConditionConfigFromInput(
      left,
      op,
      rightValue,
      rightValueType,
    );
    if (!result.config) {
      setError(result.error ?? "Enter a valid condition.");
      return;
    }

    onApply(result.config);
    setError("");
  }

  if (!clause) {
    return (
      <div className="node-preview__condition-editor" role="region" aria-label="Condition configuration">
        <p role="alert">
          This condition has no supported clause configuration. Opening this
          workflow has not changed its saved graph.
        </p>
        <p className="node-preview__help">
          Condition nodes need both a True branch and a False branch. Connect
          each branch to a node before saving or running the workflow.
        </p>
        <button type="button" onClick={initializeDefault}>
          Replace with default condition
        </button>
      </div>
    );
  }

  return (
    <form
      className="node-preview__condition-editor"
      aria-label="Condition configuration"
      onSubmit={(event) => {
        event.preventDefault();
        applyConfiguration();
      }}
    >
      <label>
        What do you want to check?
        <input
          value={left}
          onChange={(event) => setLeft(event.target.value)}
          placeholder="approved"
          aria-describedby="condition-path-help"
          aria-invalid={Boolean(error && !left.trim())}
        />
      </label>
      <p id="condition-path-help" className="node-preview__help">
        Choose a value from the workflow's execution input. Examples:{" "}
        <code>approved</code>, <code>paymentMethod</code>, or{" "}
        <code>order.total</code>.
      </p>
      <label>
        How should it be checked?
        <select
          value={op}
          onChange={(event) => setOp(event.target.value as ConditionOp)}
        >
          {conditionOperators.map((operator) => (
            <option key={operator} value={operator}>
              {CONDITION_OPERATOR_LABELS[operator]}
            </option>
          ))}
        </select>
      </label>
      {op !== "truthy" && (
        <>
          <label>
            What should it be compared with?
            <select
              value={rightValueType}
              onChange={(event) =>
                setRightValueType(event.target.value as ConditionValueType)
              }
              aria-label="Comparison value type"
            >
              <option value="string">Text</option>
              <option value="number">Number</option>
              <option value="boolean">True or false</option>
              <option value="json">Other JSON value</option>
            </select>
          </label>
          <label>
            Comparison value
            {rightValueType === "boolean" ? (
              <select
                value={rightValue}
                onChange={(event) => setRightValue(event.target.value)}
                aria-label="Comparison boolean value"
                aria-invalid={Boolean(error)}
              >
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            ) : (
              <input
                type="text"
                inputMode={rightValueType === "number" ? "decimal" : undefined}
                value={rightValue}
                onChange={(event) => setRightValue(event.target.value)}
                placeholder={
                  rightValueType === "number"
                    ? "Enter a number"
                    : rightValueType === "json"
                      ? 'For example: null, ["card"], or {"code": 1}'
                      : "Enter text"
                }
                aria-invalid={Boolean(error)}
              />
            )}
          </label>
          {rightValueType === "number" && (
            <p className="node-preview__help">
              Enter a number, such as <code>100</code> or <code>12.5</code>.
            </p>
          )}
          {rightValueType === "json" && (
            <p className="node-preview__help">
              Enter a valid JSON value. Invalid JSON is not converted
              automatically.
            </p>
          )}
        </>
      )}
      <p className="node-preview__condition-summary" aria-live="polite">
        {left.trim()
          ? op === "truthy"
            ? summarizeCondition({ left: left.trim(), op })
            : (() => {
                const parsed = parseConditionValue(rightValue, rightValueType);
                return parsed.error
                  ? "Complete the comparison value to preview this condition."
                  : summarizeCondition({
                      left: left.trim(),
                      op,
                      right: parsed.value,
                    });
              })()
          : "Enter what you want to check to preview this condition."}
      </p>
      <p className="node-preview__help">
        Add one outgoing edge for both the True and False branches. The editor
        will not create missing branches automatically.
      </p>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Apply condition</button>
    </form>
  );
}

function NodeLabelEditor({
  node,
  onApply,
}: {
  node: Node;
  onApply: (label: string) => void;
}) {
  const [label, setLabel] = useState(String(node.data.label ?? ""));
  const [error, setError] = useState("");

  function applyLabel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateNodeLabel(label);
    if (validationError) {
      setError(validationError);
      return;
    }

    onApply(label.trim());
    setError("");
  }

  return (
    <form
      className="node-preview__condition-editor"
      aria-label="Node label"
      onSubmit={applyLabel}
    >
      <label>
        Node label
        <input
          value={label}
          maxLength={120}
          onChange={(event) => setLabel(event.target.value)}
          aria-invalid={Boolean(error)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Apply label</button>
    </form>
  );
}

function NodePreview({
  workflowId,
  workflowName,
  initialGraph,
  onGraphChange,
  onSaveGraph,
}: NodePreviewProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    initialGraph?.nodes ?? initialNodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initialGraph?.edges ?? initialEdges,
  );
  const [selectedNodeId, setSelectedNodeId] = useState(
    () =>
      initialGraph?.nodes.find((node) => node.type === "condition")?.id ??
      initialGraph?.nodes[0]?.id ??
      initialNodes[0].id,
  );
  const [isSavingGraph, setIsSavingGraph] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const selectedCondition =
    selectedNode?.type === "condition"
      ? (selectedNode as WorkflowFlowNode)
      : undefined;

  const graphPayload: WorkflowGraph = useMemo(
    () => serializeWorkflowGraph(nodes, edges),
    [nodes, edges],
  );

  useEffect(() => {
    onGraphChange?.(graphPayload);
  }, [graphPayload, onGraphChange]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((currentEdges) => addEdge(connection, currentEdges));
    },
    [setEdges],
  );

  const onAddCondition = useCallback(() => {
    let index = 1;
    while (nodes.some((node) => node.id === `condition-${index}`)) {
      index += 1;
    }
    const id = `condition-${index}`;
    setSelectedNodeId(id);
    setNodes((currentNodes) => [
      ...currentNodes,
      createConditionNode(id, {
        x: 250 + index * 30,
        y: 180 + index * 30,
      }),
    ]);
  }, [nodes, setNodes]);

  function updateSelectedCondition(config: ConditionConfig) {
    if (!selectedCondition) return;
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === selectedCondition.id &&
        node.type === "condition" &&
        node.data.type === "condition"
          ? withConditionConfig(node, config)
          : node,
      ),
    );
  }

  function updateSelectedNodeLabel(label: string) {
    if (!selectedNode) return;
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === selectedNode.id ? withNodeLabel(node, label) : node,
      ),
    );
  }

  async function handleSaveGraph() {
    if (!onSaveGraph || isSavingGraph) return;

    const configError = getConditionConfigError(graphPayload);
    if (configError) {
      setSaveError(configError);
      setSaveMessage("");
      return;
    }

    setIsSavingGraph(true);
    setSaveError("");
    setSaveMessage("");
    try {
      await onSaveGraph(graphPayload);
      setSaveMessage("Workflow graph saved successfully.");
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Unable to save workflow graph.",
      );
    } finally {
      setIsSavingGraph(false);
    }
  }

  return (
    <section className="node-preview">
      <h2>Workflow Node Preview</h2>
      {workflowId && (
        <p role="status">
          Editing saved workflow: {workflowName ?? "Untitled workflow"} (ID:{" "}
          {workflowId})
        </p>
      )}
      <p>Connect nodes to preview your workflow structure.</p>
      {onSaveGraph && (
        <button
          type="button"
          onClick={() => void handleSaveGraph()}
          disabled={isSavingGraph}
        >
          {isSavingGraph ? "Saving..." : "Save workflow changes"}
        </button>
      )}
      {saveError && <p role="alert">{saveError}</p>}
      {saveMessage && <p role="status">{saveMessage}</p>}
      <button type="button" onClick={onAddCondition}>
        Add condition node
      </button>

      <div style={{ width: "100%", height: "500px" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_event, node) => {
            setSelectedNodeId(node.id);
          }}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
      {selectedNode && (
        <NodeLabelEditor
          key={`label-${selectedNode.id}`}
          node={selectedNode}
          onApply={updateSelectedNodeLabel}
        />
      )}
      {selectedCondition && (
        <ConditionConfigEditor
          key={selectedCondition.id}
          data={selectedCondition.data as ConditionNodeData}
          onApply={updateSelectedCondition}
        />
      )}
    </section>
  );
}

export default NodePreview;
