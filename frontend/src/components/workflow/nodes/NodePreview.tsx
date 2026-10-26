
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import TriggerNode from "./TriggerNode";
import TaskNode from "./TaskNode";
import ConditionNode from "./ConditionNode";
import {
  NODE_KIND_LABEL,
  type WorkflowFlowEdge,
  type WorkflowFlowNode,
  type WorkflowNodeType,
} from "./node.types";
import type { WorkflowGraph } from "../../../api/workflowApi";
import { validateWorkflowGraph } from "../../../graphValidation";

type NodePreviewProps = {
  workflowId?: string;
  workflowName?: string;
  initialGraph?: WorkflowGraph | null;
  onGraphChange?: (graph: WorkflowGraph) => void;
  onSaveGraph?: (graph: WorkflowGraph) => void | Promise<void>;
  isSaving?: boolean;
  saveError?: string;
  saveMessage?: string;
};

/**
 * Reads the agreed `clause` condition shape without inventing any new
 * configuration rules. Returns undefined when the node has no clause yet.
 */
function readConditionClause(
  config: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(config)) return undefined;
  if (!("clause" in config)) return undefined;

  const clause = config.clause;
  if (!isRecord(clause)) return undefined;

  return clause;
}

function describeCondition(config: unknown): string {
  if (!config) return "Not configured";

  if (!isRecord(config)) return JSON.stringify(config);

  const clause = readConditionClause(config);
  if (!clause) return JSON.stringify(config);

  const left = String(clause.left ?? "");
  const op = String(clause.op ?? "equals");
  const right = clause.right === undefined ? "" : String(clause.right);

  return `${left} ${op} ${right}`.trim() || "Not configured";
}

function NodeLabelEditor({
  node,
  onApply,
}: {
  node: WorkflowFlowNode;
  onApply: (label: string) => void;
}) {
  const [label, setLabel] = useState(node.data.label);

  return (
    <form
      className="node-preview__editor"
      onSubmit={(event) => {
        event.preventDefault();
        const nextLabel = label.trim();
        if (nextLabel) onApply(nextLabel);
      }}
    >
      <label>
        Node label
        <input
          value={label}
          maxLength={120}
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <button type="submit">Apply label</button>
    </form>
  );
}

function ConditionConfigEditor({
  node,
  onApply,
}: {
  node: WorkflowFlowNode;
  onApply: (config: Record<string, unknown>) => void;
}) {
  const clause = readConditionClause(node.data.config);
  const [left, setLeft] = useState(String(clause?.left ?? "approved"));
  const [right, setRight] = useState(String(clause?.right ?? "true"));

  return (
    <form
      className="node-preview__editor"
      onSubmit={(event) => {
        event.preventDefault();
        onApply({
          type: "clause",
          clause: {
            left: left.trim(),
            op: clause?.op ?? "equals",
            right: right === "true" ? true : right === "false" ? false : right,
          },
        });
      }}
    >
      <h3>Condition configuration</h3>
      <label>
        What do you want to check?
        <input value={left} onChange={(event) => setLeft(event.target.value)} />
      </label>
      <label>
        Comparison value
        <input value={right} onChange={(event) => setRight(event.target.value)} />
      </label>
      <button type="submit">Apply condition</button>
    </form>
  );
}

const initialNodes: WorkflowFlowNode[] = [
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

const initialEdges: WorkflowFlowEdge[] = [
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getInitialNodes(
  graph: WorkflowGraph | null | undefined,
): WorkflowFlowNode[] {
  if (!graph) return initialNodes;

  return graph.nodes.map((node) => {
    const { config, ...data } = node.data;

    return {
      id: node.id,
      type: node.type,
      position: node.position,
      data: {
        ...data,
        type: node.type,
        label: node.data.label,
        ...(config !== undefined ? { config } : {}),
      },
    };
  });
}

function getInitialEdges(
  graph: WorkflowGraph | null | undefined,
): WorkflowFlowEdge[] {
  if (!graph) return initialEdges;

  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle !== undefined
      ? { sourceHandle: edge.sourceHandle }
      : {}),
    ...(edge.targetHandle !== undefined
      ? { targetHandle: edge.targetHandle }
      : {}),
    ...(edge.data !== undefined ? { data: edge.data } : {}),
  }));
}

const nodeTypes = {
  trigger: TriggerNode,
  task: TaskNode,
  condition: ConditionNode,
};

function NodePreview({
  workflowId,
  workflowName,
  initialGraph,
  onGraphChange,
  onSaveGraph,
  isSaving = false,
  saveError,
  saveMessage,
}: NodePreviewProps) {
  const [nodes, setNodes, onNodesChange] =
    useNodesState<WorkflowFlowNode>(getInitialNodes(initialGraph));
  const [edges, setEdges, onEdgesChange] =
    useEdgesState<WorkflowFlowEdge>(getInitialEdges(initialGraph));
  const [selectedNodeId, setSelectedNodeId] = useState("condition-1");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);

  const graphPayload: WorkflowGraph = useMemo(
    () => ({
      version: 1,
      nodes: nodes.map((node) => {
        const nodeType = node.type as WorkflowNodeType;

        return {
          id: node.id,
          type: nodeType,
          position: node.position,
          data: {
            ...(node.data as Record<string, unknown>),
            type: nodeType,
            label: node.data.label,
          },
        };
      }),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.sourceHandle !== null && edge.sourceHandle !== undefined
          ? { sourceHandle: edge.sourceHandle }
          : {}),
        ...(edge.targetHandle !== null && edge.targetHandle !== undefined
          ? { targetHandle: edge.targetHandle }
          : {}),
        ...(edge.data !== undefined ? { data: edge.data } : {}),
      })),
    }),
    [nodes, edges],
  );

  const validationErrors = useMemo(
    () => validateWorkflowGraph(graphPayload),
    [graphPayload],
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

  const applyLabel = useCallback(
    (label: string) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNodeId
            ? { ...node, data: { ...node.data, label } }
            : node,
        ),
      );
    },
    [selectedNodeId, setNodes],
  );

  const applyConditionConfig = useCallback(
    (config: Record<string, unknown>) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNodeId
            ? { ...node, data: { ...node.data, config } }
            : node,
        ),
      );
    },
    [selectedNodeId, setNodes],
  );

  const addConditionNode = useCallback(() => {
    let index = nodes.length + 1;
    let id = `condition-${index}`;

    while (nodes.some((node) => node.id === id)) {
      index += 1;
      id = `condition-${index}`;
    }

    const newNode: WorkflowFlowNode = {
      id,
      type: "condition",
      position: {
        x: 160 + (nodes.length % 3) * 240,
        y: 480 + (nodes.length % 2) * 120,
      },
      data: {
        type: "condition",
        label: "New condition",
      },
    };

    setNodes((currentNodes) => [...currentNodes, newNode]);
    setSelectedNodeId(id);
  }, [nodes, setNodes]);

  const removeSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) return;

    setEdges((currentEdges) =>
      currentEdges.filter((edge) => edge.id !== selectedEdgeId),
    );
    setSelectedEdgeId(null);
  }, [selectedEdgeId, setEdges]);

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
        <div className="workflow-card__actions">
          <button
            type="button"
            className="workflow-card__run"
            onClick={() => void onSaveGraph(graphPayload)}
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
          {saveError && <p role="alert">{saveError}</p>}
          {saveMessage && <p role="status">{saveMessage}</p>}
        </div>
      )}

      <div className="node-preview__toolbar">
        <button type="button" onClick={addConditionNode}>
          Add condition node
        </button>
        <button
          type="button"
          onClick={removeSelectedEdge}
          disabled={!selectedEdge}
        >
          Remove selected edge
        </button>
        <span className="node-preview__hint">
          {selectedEdge
            ? `Selected edge: ${selectedEdge.id}`
            : "Select an edge to remove it."}
        </span>
      </div>

      {validationErrors.length > 0 && (
        <div className="node-preview__errors" role="alert">
          <p className="node-preview__errors-title">
            This graph does not satisfy the workflow contract yet:
          </p>
          <ul>
            {validationErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="node-preview__workspace">
        <div className="node-preview__canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
            onPaneClick={() => setSelectedEdgeId(null)}
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        <aside className="node-preview__details" aria-live="polite">
          <p className="node-preview__eyebrow">Selected node</p>

          {selectedNode ? (
            <>
              <h3>{selectedNode.data.label}</h3>

              <dl>
                <div>
                  <dt>Type</dt>
                  <dd>{NODE_KIND_LABEL[selectedNode.data.type]}</dd>
                </div>
                <div>
                  <dt>Node ID</dt>
                  <dd>{selectedNode.id}</dd>
                </div>
                <div>
                  <dt>Position</dt>
                  <dd>
                    x {Math.round(selectedNode.position.x)}, y{" "}
                    {Math.round(selectedNode.position.y)}
                  </dd>
                </div>
                {selectedNode.data.type === "condition" && (
                  <div>
                    <dt>Condition</dt>
                    <dd>{describeCondition(selectedNode.data.config)}</dd>
                  </div>
                )}
              </dl>

              <NodeLabelEditor
                key={`label-${selectedNode.id}`}
                node={selectedNode}
                onApply={applyLabel}
              />

              {selectedNode.data.type === "condition" && (
                <ConditionConfigEditor
                  key={`config-${selectedNode.id}`}
                  node={selectedNode}
                  onApply={applyConditionConfig}
                />
              )}
            </>
          ) : (
            <p className="node-preview__note">
              Select a node on the canvas to edit its label and configuration.
            </p>
          )}
        </aside>

        <details className="node-preview__payload">
          <summary>Current graph payload</summary>
          <pre>{JSON.stringify(graphPayload, null, 2)}</pre>
        </details>
      </div>
    </section>
  );
}

export default NodePreview;
