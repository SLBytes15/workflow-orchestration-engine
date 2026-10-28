
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import TriggerNode from "./TriggerNode";
import TaskNode from "./TaskNode";
import ConditionNode from "./ConditionNode";
import {
  createConditionNode,
  createTaskNode,
  createTriggerNode,
  NODE_KIND_LABEL,
  type WorkflowFlowEdge,
  type WorkflowFlowNode,
  type WorkflowNodeType,
} from "./node.types";
import type { WorkflowGraph } from "../../../api/workflowApi";
import {
  validateWorkflowGraphDetailed,
  type GraphValidationError,
} from "../../../graphValidation";
import WorkflowWizard from "../wizard/WorkflowWizard";
import type { WorkflowStatus } from "../../../workflowState";

type NodePreviewProps = {
  workflowId?: string;
  workflowName?: string;
  workflowDescription?: string;
  workflowStatus?: WorkflowStatus;
  initialGraph?: WorkflowGraph | null;
  onGraphChange?: (graph: WorkflowGraph) => void;
  onSaveGraph?: (
    graph: WorkflowGraph,
    metadata?: { name?: string; description?: string },
  ) => void | Promise<void>;
  isSaving?: boolean;
  saveError?: string;
  saveMessage?: string;
  onActivateWorkflow?: () => void | Promise<void>;
  onPauseWorkflow?: () => void | Promise<void>;
  onResumeWorkflow?: () => void | Promise<void>;
  isStatusActionPending?: boolean;
  statusActionError?: string;
  statusActionMessage?: string;
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
      <label className="node-preview__field-label">
        Node label
        <input
          className="node-preview__input"
          value={label}
          maxLength={120}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Enter descriptive label..."
        />
      </label>
      <button type="submit" className="node-preview__btn-primary">
        Apply label
      </button>
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
      className="node-preview__editor node-preview__condition-editor-form"
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
      <h4 className="node-preview__section-title">Condition logic</h4>
      <label className="node-preview__field-label">
        Field path / Property
        <input
          className="node-preview__input"
          value={left}
          onChange={(event) => setLeft(event.target.value)}
          placeholder="e.g. approved, status, amount"
        />
      </label>
      <label className="node-preview__field-label">
        Comparison value
        <input
          className="node-preview__input"
          value={right}
          onChange={(event) => setRight(event.target.value)}
          placeholder="e.g. true, gold, 100"
        />
      </label>
      <button type="submit" className="node-preview__btn-primary">
        Apply condition
      </button>
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

function NodePreviewCanvas({
  workflowId,
  workflowName,
  workflowDescription,
  workflowStatus,
  initialGraph,
  onGraphChange,
  onSaveGraph,
  isSaving = false,
  saveError,
  saveMessage,
  onActivateWorkflow,
  onPauseWorkflow,
  onResumeWorkflow,
  isStatusActionPending = false,
  statusActionError,
  statusActionMessage,
}: NodePreviewProps) {
  const { screenToFlowPosition } = useReactFlow();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] =
    useNodesState<WorkflowFlowNode>(getInitialNodes(initialGraph));
  const [edges, setEdges, onEdgesChange] =
    useEdgesState<WorkflowFlowEdge>(getInitialEdges(initialGraph));
  const [selectedNodeId, setSelectedNodeId] = useState("condition-1");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"wizard" | "canvas">("wizard");
  const [hasUserEditedCanvas, setHasUserEditedCanvas] = useState(false);

  const prevInitialGraphRef = useRef(initialGraph);
  const prevWorkflowIdRef = useRef(workflowId);
  const lastEmittedGraphRef = useRef<WorkflowGraph | null>(null);
  const isCanvasUserEdited = useRef(false);

  const markCanvasEdited = useCallback(() => {
    isCanvasUserEdited.current = true;
    setHasUserEditedCanvas(true);
  }, []);

  // Synchronize canvas nodes and edges when external graph or workflow changes
  useEffect(() => {
    const isWorkflowChanged = workflowId !== prevWorkflowIdRef.current;
    const isExternalGraphChange =
      initialGraph !== prevInitialGraphRef.current &&
      initialGraph !== lastEmittedGraphRef.current;

    if (isWorkflowChanged || isExternalGraphChange) {
      prevWorkflowIdRef.current = workflowId;
      prevInitialGraphRef.current = initialGraph;
      isCanvasUserEdited.current = false;
      setHasUserEditedCanvas(false);
      setNodes(getInitialNodes(initialGraph));
      setEdges(getInitialEdges(initialGraph));
    } else {
      prevWorkflowIdRef.current = workflowId;
      prevInitialGraphRef.current = initialGraph;
    }
  }, [initialGraph, workflowId, setNodes, setEdges]);

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

  const validationIssues: GraphValidationError[] = useMemo(
    () => validateWorkflowGraphDetailed(graphPayload),
    [graphPayload],
  );

  useEffect(() => {
    if (editorMode === "canvas" && isCanvasUserEdited.current) {
      lastEmittedGraphRef.current = graphPayload;
      onGraphChange?.(graphPayload);
    }
  }, [graphPayload, editorMode, onGraphChange]);

  const handleNodesChange: typeof onNodesChange = useCallback(
    (changes) => {
      const hasMeaningfulChange = changes.some(
        (c) => c.type === "position" || c.type === "remove",
      );
      if (hasMeaningfulChange) {
        markCanvasEdited();
      }
      onNodesChange(changes);
    },
    [onNodesChange, markCanvasEdited],
  );

  const handleEdgesChange: typeof onEdgesChange = useCallback(
    (changes) => {
      const hasMeaningfulChange = changes.some((c) => c.type === "remove");
      if (hasMeaningfulChange) {
        markCanvasEdited();
      }
      onEdgesChange(changes);
    },
    [onEdgesChange, markCanvasEdited],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      markCanvasEdited();
      setEdges((currentEdges) => addEdge(connection, currentEdges));
    },
    [setEdges, markCanvasEdited],
  );

  const applyLabel = useCallback(
    (label: string) => {
      markCanvasEdited();
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNodeId
            ? { ...node, data: { ...node.data, label } }
            : node,
        ),
      );
    },
    [selectedNodeId, setNodes, markCanvasEdited],
  );

  const applyConditionConfig = useCallback(
    (config: Record<string, unknown>) => {
      markCanvasEdited();
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNodeId
            ? { ...node, data: { ...node.data, config } }
            : node,
        ),
      );
    },
    [selectedNodeId, setNodes, markCanvasEdited],
  );

  const hasTrigger = useMemo(
    () => nodes.some((node) => node.type === "trigger"),
    [nodes],
  );

  const createNodeForType = useCallback(
    (
      type: WorkflowNodeType,
      position?: { x: number; y: number },
    ): WorkflowFlowNode | null => {
      if (type === "trigger") {
        if (nodes.some((node) => node.type === "trigger")) return null;
        let index = 1;
        let id = `trigger-${index}`;
        while (nodes.some((node) => node.id === id)) {
          index += 1;
          id = `trigger-${index}`;
        }
        return createTriggerNode(id, position ?? { x: 250, y: 50 });
      }

      if (type === "task") {
        let index = nodes.length + 1;
        let id = `task-${index}`;
        while (nodes.some((node) => node.id === id)) {
          index += 1;
          id = `task-${index}`;
        }
        return createTaskNode(
          id,
          position ?? {
            x: 160 + (nodes.length % 3) * 240,
            y: 480 + (nodes.length % 2) * 120,
          },
        );
      }

      if (type === "condition") {
        let index = nodes.length + 1;
        let id = `condition-${index}`;
        while (nodes.some((node) => node.id === id)) {
          index += 1;
          id = `condition-${index}`;
        }
        return createConditionNode(
          id,
          position ?? {
            x: 160 + (nodes.length % 3) * 240,
            y: 480 + (nodes.length % 2) * 120,
          },
        );
      }

      return null;
    },
    [nodes],
  );

  const addTriggerNode = useCallback(() => {
    const newNode = createNodeForType("trigger");
    if (!newNode) return;
    markCanvasEdited();
    setNodes((currentNodes) => [...currentNodes, newNode]);
    setSelectedNodeId(newNode.id);
  }, [createNodeForType, setNodes, markCanvasEdited]);

  const addTaskNode = useCallback(() => {
    const newNode = createNodeForType("task");
    if (!newNode) return;
    markCanvasEdited();
    setNodes((currentNodes) => [...currentNodes, newNode]);
    setSelectedNodeId(newNode.id);
  }, [createNodeForType, setNodes, markCanvasEdited]);

  const addConditionNode = useCallback(() => {
    const newNode = createNodeForType("condition");
    if (!newNode) return;
    markCanvasEdited();
    setNodes((currentNodes) => [...currentNodes, newNode]);
    setSelectedNodeId(newNode.id);
  }, [createNodeForType, setNodes, markCanvasEdited]);

  const onDragStart = (
    event: React.DragEvent,
    nodeType: WorkflowNodeType,
  ) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData(
        "application/reactflow",
      ) as WorkflowNodeType;
      if (
        !type ||
        (type !== "trigger" && type !== "task" && type !== "condition")
      ) {
        return;
      }

      let position: { x: number; y: number };
      try {
        position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
      } catch {
        const bounds = reactFlowWrapper.current?.getBoundingClientRect();
        position = bounds
          ? {
              x: event.clientX - bounds.left,
              y: event.clientY - bounds.top,
            }
          : { x: 250, y: 150 };
      }

      const newNode = createNodeForType(type, position);
      if (!newNode) return;

      markCanvasEdited();
      setNodes((currentNodes) => [...currentNodes, newNode]);
      setSelectedNodeId(newNode.id);
    },
    [createNodeForType, setNodes, screenToFlowPosition, markCanvasEdited],
  );

  const removeSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) return;

    markCanvasEdited();
    setEdges((currentEdges) =>
      currentEdges.filter((edge) => edge.id !== selectedEdgeId),
    );
    setSelectedEdgeId(null);
  }, [selectedEdgeId, setEdges, markCanvasEdited]);

  return (
    <section className="node-preview">
      <div className="node-preview__mode-bar">
        <div
          className="node-preview__mode-toggle"
          role="tablist"
          aria-label="Workflow Editor View Mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={editorMode === "wizard"}
            className={`node-preview__mode-btn ${
              editorMode === "wizard" ? "node-preview__mode-btn--active" : ""
            }`}
            onClick={() => setEditorMode("wizard")}
          >
            Guided Wizard
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={editorMode === "canvas"}
            className={`node-preview__mode-btn ${
              editorMode === "canvas" ? "node-preview__mode-btn--active" : ""
            }`}
            onClick={() => setEditorMode("canvas")}
          >
            Visual Canvas
          </button>
        </div>
      </div>

      {editorMode === "wizard" ? (
        <WorkflowWizard
          initialGraph={
            hasUserEditedCanvas
              ? graphPayload
              : (initialGraph ?? graphPayload)
          }
          workflowId={workflowId}
          workflowName={workflowName}
          workflowDescription={workflowDescription}
          workflowStatus={workflowStatus}
          onGraphChange={onGraphChange}
          onSaveGraph={onSaveGraph}
          isSaving={isSaving}
          saveError={saveError}
          saveMessage={saveMessage}
          onSwitchToVisual={() => setEditorMode("canvas")}
        />
      ) : (
        <>
          <div className="node-preview__header">
            <div>
              <h2>Workflow Node Preview</h2>
              {workflowId ? (
                <p role="status" className="node-preview__meta">
                  Editing saved workflow: <strong>{workflowName ?? "Untitled workflow"}</strong> (ID:{" "}
                  <code>{workflowId}</code>)
                </p>
              ) : (
                <p className="node-preview__meta">Connect nodes to preview and configure your workflow structure.</p>
              )}
            </div>

            <div className="node-preview__save-bar">
              {workflowStatus && (
                <span
                  className={`node-preview__status-badge node-preview__status-badge--${workflowStatus.toLowerCase()}`}
                  role="status"
                  aria-label={`Workflow status: ${workflowStatus}`}
                >
                  {workflowStatus}
                </span>
              )}

              {workflowId && workflowStatus === "Draft" && onActivateWorkflow && (
                <button
                  type="button"
                  className="node-preview__action-btn node-preview__action-btn--activate"
                  onClick={() => void onActivateWorkflow()}
                  disabled={isStatusActionPending || isSaving}
                >
                  {isStatusActionPending ? "Activating..." : "Activate"}
                </button>
              )}

              {workflowId && workflowStatus === "Active" && onPauseWorkflow && (
                <button
                  type="button"
                  className="node-preview__action-btn node-preview__action-btn--pause"
                  onClick={() => void onPauseWorkflow()}
                  disabled={isStatusActionPending || isSaving}
                >
                  {isStatusActionPending ? "Pausing..." : "Pause"}
                </button>
              )}

              {workflowId && workflowStatus === "Paused" && onResumeWorkflow && (
                <button
                  type="button"
                  className="node-preview__action-btn node-preview__action-btn--resume"
                  onClick={() => void onResumeWorkflow()}
                  disabled={isStatusActionPending || isSaving}
                >
                  {isStatusActionPending ? "Resuming..." : "Resume"}
                </button>
              )}

              {onSaveGraph && (
                <button
                  type="button"
                  className="node-preview__save-btn"
                  onClick={() =>
                    void onSaveGraph(graphPayload, {
                      name: workflowName,
                      description: workflowDescription,
                    })
                  }
                  disabled={isSaving || isStatusActionPending}
                >
                  {isSaving ? "Saving..." : workflowId ? "Save Changes" : "Save Workflow"}
                </button>
              )}
            </div>
          </div>

          {(saveError || saveMessage || statusActionError || statusActionMessage) && (
            <div className="node-preview__save-alerts">
              {statusActionError && (
                <div className="node-preview__save-alert node-preview__save-alert--error" role="alert">
                  <span className="node-preview__alert-icon" aria-hidden="true">⚠️</span>
                  <span>{statusActionError}</span>
                </div>
              )}
              {statusActionMessage && (
                <div className="node-preview__save-alert node-preview__save-alert--success" role="status">
                  <span className="node-preview__alert-icon" aria-hidden="true">✓</span>
                  <span>{statusActionMessage}</span>
                </div>
              )}
              {saveError && (
                <div className="node-preview__save-alert node-preview__save-alert--error" role="alert">
                  <span className="node-preview__alert-icon" aria-hidden="true">⚠️</span>
                  <span>{saveError}</span>
                </div>
              )}
              {saveMessage && (
                <div className="node-preview__save-alert node-preview__save-alert--success" role="status">
                  <span className="node-preview__alert-icon" aria-hidden="true">✓</span>
                  <span>{saveMessage}</span>
                </div>
              )}
            </div>
          )}

          <div className="node-preview__toolbar" role="toolbar" aria-label="Workflow Canvas Tools">
            <div className="node-preview__toolbar-group">
              <span className="node-preview__toolbar-label">Add node:</span>
              {!hasTrigger && (
                <button
                  type="button"
                  className="node-preview__tool-btn node-preview__tool-btn--trigger"
                  draggable
                  onDragStart={(event) => onDragStart(event, "trigger")}
                  onClick={addTriggerNode}
                  title="Click to add or drag onto canvas"
                >
                  <span aria-hidden="true">⚡</span>
                  <span>Trigger</span>
                </button>
              )}
              <button
                type="button"
                className="node-preview__tool-btn node-preview__tool-btn--task"
                draggable
                onDragStart={(event) => onDragStart(event, "task")}
                onClick={addTaskNode}
                title="Click to add or drag onto canvas"
              >
                <span aria-hidden="true">⚙</span>
                <span>Task</span>
              </button>
              <button
                type="button"
                className="node-preview__tool-btn node-preview__tool-btn--condition"
                draggable
                onDragStart={(event) => onDragStart(event, "condition")}
                onClick={addConditionNode}
                title="Click to add or drag onto canvas"
              >
                <span aria-hidden="true">◆</span>
                <span>Condition</span>
              </button>
            </div>

            <div className="node-preview__toolbar-group node-preview__toolbar-group--actions">
              <button
                type="button"
                className="node-preview__tool-btn node-preview__tool-btn--delete"
                onClick={removeSelectedEdge}
                disabled={!selectedEdge}
                aria-label={selectedEdge ? `Remove connection ${selectedEdge.id}` : "Remove selected edge"}
              >
                <span aria-hidden="true">✕</span>
                <span>Remove edge</span>
              </button>
              <span className="node-preview__hint" aria-live="polite">
                {selectedEdge
                  ? `Selected connection: ${selectedEdge.id}`
                  : "Click a connection edge or node to inspect."}
              </span>
            </div>
          </div>

          {validationIssues.length > 0 && (
            <div className="node-preview__errors" role="alert">
              <p className="node-preview__errors-title">
                This graph does not satisfy the workflow contract yet:
              </p>
              <ul>
                {validationIssues.map((issue) => (
                  <li key={issue.message} className="node-preview__error-item">
                    <span>{issue.message}</span>
                    {issue.nodeId && (
                      <button
                        type="button"
                        className="node-preview__error-focus"
                        onClick={() => setSelectedNodeId(issue.nodeId!)}
                      >
                        Focus node
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="node-preview__workspace">
            <div
              ref={reactFlowWrapper}
              className="node-preview__canvas"
              onDragOver={onDragOver}
              onDrop={onDrop}
            >
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
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
              <div className="node-preview__details-header">
                <span className="node-preview__eyebrow">Inspector</span>
                {selectedNode && (
                  <span className={`node-preview__type-badge node-preview__type-badge--${selectedNode.data.type}`}>
                    {NODE_KIND_LABEL[selectedNode.data.type]}
                  </span>
                )}
              </div>

              {selectedNode ? (
                <>
                  <h3 className="node-preview__details-title">{selectedNode.data.label}</h3>

                  <dl className="node-preview__property-list">
                    <div className="node-preview__property-row">
                      <dt>Node ID</dt>
                      <dd><code>{selectedNode.id}</code></dd>
                    </div>
                    <div className="node-preview__property-row">
                      <dt>Position</dt>
                      <dd>
                        x: {Math.round(selectedNode.position.x)}, y: {Math.round(selectedNode.position.y)}
                      </dd>
                    </div>
                    {selectedNode.data.type === "condition" && (
                      <div className="node-preview__property-row">
                        <dt>Rule</dt>
                        <dd className="node-preview__condition-summary">
                          {describeCondition(selectedNode.data.config)}
                        </dd>
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
                <div className="node-preview__empty-selection">
                  <span className="node-preview__empty-icon" aria-hidden="true">👆</span>
                  <p className="node-preview__note">
                    Select a node on the canvas to inspect and edit its label or configuration.
                  </p>
                </div>
              )}
            </aside>

            <details className="node-preview__payload">
              <summary>Current graph payload</summary>
              <pre>{JSON.stringify(graphPayload, null, 2)}</pre>
            </details>
          </div>
        </>
      )}
    </section>
  );
}

export default function NodePreview(props: NodePreviewProps) {
  return (
    <ReactFlowProvider>
      <NodePreviewCanvas {...props} />
    </ReactFlowProvider>
  );
}
