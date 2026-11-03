
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
  CONDITION_OPERATOR_LABELS,
  createConditionConfigFromInput,
  getConditionValueType,
  HANDLE,
  NODE_KIND_LABEL,
  type ConditionOp,
  type ConditionValueType,
  type WorkflowFlowEdge,
  type WorkflowFlowNode,
  type WorkflowNodeType,
  validateNodeLabel,
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
  onNavigate?: (page: string) => void;
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
  const [error, setError] = useState("");

  return (
    <form
      className="node-preview__editor"
      onSubmit={(event) => {
        event.preventDefault();
        const validationError = validateNodeLabel(label);
        if (validationError) {
          setError(validationError);
          return;
        }
        setError("");
        onApply(label.trim());
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
          aria-invalid={Boolean(error)}
        />
      </label>
      {error && (
        <p className="node-preview__field-error" role="alert">
          {error}
        </p>
      )}
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
  const [operator, setOperator] = useState<ConditionOp>(
    typeof clause?.op === "string" &&
      Object.hasOwn(CONDITION_OPERATOR_LABELS, clause.op)
      ? (clause?.op as ConditionOp)
      : "equals",
  );
  const [valueType, setValueType] = useState<ConditionValueType>(
    getConditionValueType(clause?.right ?? true),
  );
  const [right, setRight] = useState(() => {
    const value = clause?.right ?? true;
    return typeof value === "string" ? value : JSON.stringify(value);
  });
  const [error, setError] = useState("");

  return (
    <form
      className="node-preview__editor node-preview__condition-editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        const result = createConditionConfigFromInput(
          left,
          operator,
          right,
          valueType,
        );
        if (result.error || !result.config) {
          setError(result.error ?? "Enter a valid condition.")
          return
        }
        setError("")
        onApply(result.config)
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
      <label className="node-preview__field-label" htmlFor={`condition-op-${node.id}`}>
        Comparison
        <select
          id={`condition-op-${node.id}`}
          className="node-preview__input"
          value={operator}
          onChange={(event) => setOperator(event.target.value as ConditionOp)}
        >
          {Object.entries(CONDITION_OPERATOR_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {operator !== "truthy" && (
        <>
          <label className="node-preview__field-label" htmlFor={`condition-value-type-${node.id}`}>
            Value type
            <select
              id={`condition-value-type-${node.id}`}
              className="node-preview__input"
              value={valueType}
              onChange={(event) =>
                setValueType(event.target.value as ConditionValueType)
              }
            >
              <option value="string">Text</option>
              <option value="number">Number</option>
              <option value="boolean">Boolean</option>
              <option value="json">JSON</option>
            </select>
          </label>
          <label className="node-preview__field-label">
        Comparison value
        <input
          className="node-preview__input"
          value={right}
          onChange={(event) => setRight(event.target.value)}
          placeholder={
            valueType === "json"
              ? 'e.g. {"tier":"gold"}'
              : valueType === "number"
                ? "e.g. 100"
                : valueType === "boolean"
                  ? "true or false"
                  : "e.g. approved"
          }
        />
      </label>
        </>
      )}
      {error && (
        <p className="node-preview__field-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="node-preview__btn-primary">
        Apply condition
      </button>
    </form>
  );
}

function NodeConfigEditor({
  node,
  onApply,
}: {
  node: WorkflowFlowNode;
  onApply: (config: Record<string, unknown>) => void;
}) {
  const [config, setConfig] = useState(() =>
    JSON.stringify(node.data.config ?? {}, null, 2),
  );
  const [error, setError] = useState("");

  return (
    <form
      className="node-preview__editor"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const parsed: unknown = JSON.parse(config);
          if (!isRecord(parsed)) {
            setError("Configuration must be a JSON object.")
            return
          }
          setError("")
          onApply(parsed)
        } catch {
          setError("Enter valid JSON configuration.")
        }
      }}
    >
      <h4 className="node-preview__section-title">Configuration</h4>
      <label className="node-preview__field-label" htmlFor={`node-config-${node.id}`}>
        Node configuration (JSON)
        <textarea
          id={`node-config-${node.id}`}
          className="node-preview__input node-preview__json-input"
          value={config}
          onChange={(event) => setConfig(event.target.value)}
          spellCheck={false}
          rows={8}
          aria-describedby={`node-config-help-${node.id}`}
        />
      </label>
      <p className="node-preview__note" id={`node-config-help-${node.id}`}>
        Use the existing workflow graph configuration shape for this node type.
      </p>
      {error && (
        <p className="node-preview__field-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="node-preview__btn-primary">
        Apply configuration
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
    ...(edge.sourceHandle === HANDLE.branchTrue
      ? { label: "True" }
      : edge.sourceHandle === HANDLE.branchFalse
        ? { label: "False" }
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
  onNavigate,
}: NodePreviewProps) {
  const { fitView, screenToFlowPosition } = useReactFlow();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] =
    useNodesState<WorkflowFlowNode>(getInitialNodes(initialGraph));
  const [edges, setEdges, onEdgesChange] =
    useEdgesState<WorkflowFlowEdge>(getInitialEdges(initialGraph));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"wizard" | "canvas">("canvas");
  const [hasUserEditedCanvas, setHasUserEditedCanvas] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [nodeSearch, setNodeSearch] = useState("");
  const [draftName, setDraftName] = useState(workflowName ?? "Untitled Workflow");
  const [connectionError, setConnectionError] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(!workflowId);

  const prevInitialGraphRef = useRef(initialGraph);
  const prevWorkflowIdRef = useRef(workflowId);
  const lastEmittedGraphRef = useRef<WorkflowGraph | null>(null);
  const isCanvasUserEdited = useRef(false);

  useEffect(() => {
    const mobileViewport = window.matchMedia("(max-width: 768px)");
    const handleViewportChange = () => {
      if (mobileViewport.matches) {
        setPaletteOpen(false);
      }
    };

    handleViewportChange();
    mobileViewport.addEventListener("change", handleViewportChange);
    return () =>
      mobileViewport.removeEventListener("change", handleViewportChange);
  }, []);

  const markCanvasEdited = useCallback(() => {
    isCanvasUserEdited.current = true;
    setHasUserEditedCanvas(true);
    setHasUnsavedChanges(true);
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
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
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
      if (
        changes.some(
          (change) =>
            change.type === "remove" && change.id === selectedNodeId,
        )
      ) {
        setSelectedNodeId(null);
      }
      onNodesChange(changes);
    },
    [onNodesChange, markCanvasEdited, selectedNodeId],
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
      const sourceNode = nodes.find((node) => node.id === connection.source);
      if (
        sourceNode?.type === "condition" &&
        edges.some(
          (edge) =>
            edge.source === connection.source &&
            edge.sourceHandle === connection.sourceHandle,
        )
      ) {
        setConnectionError(
          `${connection.sourceHandle === HANDLE.branchTrue ? "True" : "False"} branch already has a connection.`,
        );
        setBottomPanelOpen(true);
        return;
      }
      setConnectionError("");
      markCanvasEdited();
      const branchLabel =
        connection.sourceHandle === HANDLE.branchTrue
          ? "True"
          : connection.sourceHandle === HANDLE.branchFalse
            ? "False"
            : undefined;
      setEdges((currentEdges) =>
        addEdge(
          {
            ...connection,
            type: "smoothstep",
            ...(branchLabel ? { label: branchLabel } : {}),
          },
          currentEdges,
        ),
      );
    },
    [nodes, edges, setEdges, markCanvasEdited],
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

  const openInspector = useCallback(() => {
    setInspectorOpen(true);
    if (window.matchMedia("(max-width: 768px)").matches) {
      setPaletteOpen(false);
    }
  }, []);

  const getNextNodePosition = useCallback(() => {
    const rightmostNode = nodes.reduce<WorkflowFlowNode | null>(
      (rightmost, node) =>
        !rightmost || node.position.x > rightmost.position.x ? node : rightmost,
      null,
    );
    if (!rightmostNode) return { x: 250, y: 180 };

    return {
      x: rightmostNode.position.x + 260,
      y: selectedNode?.position.y ?? rightmostNode.position.y,
    };
  }, [nodes, selectedNode]);

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
        const nextPosition = position ?? getNextNodePosition();
        return createTaskNode(
          id,
          nextPosition,
        );
      }

      if (type === "condition") {
        let index = nodes.length + 1;
        let id = `condition-${index}`;
        while (nodes.some((node) => node.id === id)) {
          index += 1;
          id = `condition-${index}`;
        }
        const nextPosition = position ?? getNextNodePosition();
        return createConditionNode(
          id,
          nextPosition,
        );
      }

      return null;
    },
    [nodes, getNextNodePosition],
  );

  const addNode = useCallback((type: WorkflowNodeType) => {
    const newNode = createNodeForType(type);
    if (!newNode) return;
    markCanvasEdited();
    setNodes((currentNodes) => [...currentNodes, newNode]);
    setSelectedNodeId(newNode.id);
    setSelectedEdgeId(null);
    openInspector();
    window.requestAnimationFrame(() => {
      void fitView({ padding: 0.24, duration: 220 });
    });
  }, [createNodeForType, setNodes, markCanvasEdited, openInspector, fitView]);

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
      setSelectedEdgeId(null);
      openInspector();
    },
    [
      createNodeForType,
      setNodes,
      screenToFlowPosition,
      markCanvasEdited,
      openInspector,
    ],
  );

  const removeSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;
    markCanvasEdited();
    setNodes((currentNodes) =>
      currentNodes.filter((node) => node.id !== selectedNodeId),
    );
    setEdges((currentEdges) =>
      currentEdges.filter(
        (edge) =>
          edge.source !== selectedNodeId && edge.target !== selectedNodeId,
      ),
    );
    setSelectedNodeId(null);
    setInspectorOpen(false);
  }, [selectedNodeId, setNodes, setEdges, markCanvasEdited]);

  const removeSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) return;

    markCanvasEdited();
    setEdges((currentEdges) =>
      currentEdges.filter((edge) => edge.id !== selectedEdgeId),
    );
    setSelectedEdgeId(null);
    setInspectorOpen(false);
  }, [selectedEdgeId, setEdges, markCanvasEdited]);

  const clearSelection = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setInspectorOpen(false);
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({ ...node, selected: false })),
    );
    setEdges((currentEdges) =>
      currentEdges.map((edge) => ({ ...edge, selected: false })),
    );
  }, [setNodes, setEdges]);

  const handleSave = useCallback(async () => {
    if (!onSaveGraph) return;
    await onSaveGraph(graphPayload, {
      name: draftName.trim(),
      description: workflowDescription,
    });
    setHasUserEditedCanvas(false);
    setHasUnsavedChanges(false);
  }, [onSaveGraph, graphPayload, draftName, workflowDescription]);

  const availableNodeTypes: Array<{
    type: WorkflowNodeType;
    title: string;
    description: string;
    icon: string;
  }> = [
    {
      type: "trigger",
      title: "Trigger",
      description: "Workflow entry point",
      icon: "⏵",
    },
    {
      type: "task",
      title: "Task",
      description: "Run a workflow action",
      icon: "▣",
    },
    {
      type: "condition",
      title: "Condition",
      description: "Branch on a rule",
      icon: "◇",
    },
  ];
  const filteredNodeTypes = availableNodeTypes.filter((item) =>
    `${item.title} ${item.description}`
      .toLowerCase()
      .includes(nodeSearch.trim().toLowerCase()),
  );

  return (
    <section
      className={`node-preview ${
        editorMode === "canvas" ? "node-preview--studio" : ""
      }`}
    >
      {editorMode === "wizard" ? (
        <>
          <div className="node-preview__mode-bar">
            <button
              type="button"
              className="node-preview__mode-btn"
              onClick={() => setEditorMode("canvas")}
            >
              Open visual studio
            </button>
          </div>
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
        </>
      ) : (
        <div className="workflow-studio">
          <header className="workflow-studio__toolbar">
            <div className="workflow-studio__identity">
              <div className="workflow-studio__breadcrumbs">
                <button
                  type="button"
                  onClick={() => onNavigate?.("Workflows")}
                  disabled={!onNavigate}
                >
                  Workflows
                </button>
                <span aria-hidden="true">/</span>
                <span>Workflow Builder</span>
              </div>
              <div className="workflow-studio__title-row">
                <label className="workflow-studio__name-label" htmlFor="workflow-studio-name">
                  Workflow name
                </label>
                <input
                  id="workflow-studio-name"
                  className="workflow-studio__name"
                  value={draftName}
                  maxLength={120}
                  onChange={(event) => {
                    setDraftName(event.target.value);
                    setHasUnsavedChanges(true);
                  }}
                />
                {workflowStatus && (
                  <span
                    className={`node-preview__status-badge node-preview__status-badge--${workflowStatus.toLowerCase()}`}
                    role="status"
                  >
                    {workflowStatus}
                  </span>
                )}
                <span
                  className={`workflow-studio__save-state ${
                    saveError
                      ? "workflow-studio__save-state--error"
                      : hasUnsavedChanges
                        ? "workflow-studio__save-state--pending"
                        : ""
                  }`}
                  role="status"
                >
                  {isSaving
                    ? "Saving…"
                    : saveError
                      ? "Save failed"
                      : hasUnsavedChanges
                        ? "Unsaved changes"
                        : "All changes saved"}
                </span>
              </div>
            </div>

            <div className="workflow-studio__actions" role="toolbar" aria-label="Workflow actions">
              <button
                type="button"
                className="workflow-studio__button"
                onClick={() => setEditorMode("wizard")}
              >
                Guided setup
              </button>
              <button
                type="button"
                className={`workflow-studio__button workflow-studio__button--toggle ${
                  paletteOpen ? "is-active" : ""
                }`}
                aria-expanded={paletteOpen}
                aria-controls="workflow-node-palette"
                onClick={() => {
                  if (paletteOpen) {
                    setPaletteOpen(false);
                  } else {
                    setPaletteOpen(true);
                    if (window.matchMedia("(max-width: 768px)").matches) {
                      setInspectorOpen(false);
                    }
                  }
                }}
              >
                Nodes
              </button>
              <button
                type="button"
                className={`workflow-studio__button workflow-studio__button--toggle ${
                  inspectorOpen ? "is-active" : ""
                }`}
                aria-expanded={inspectorOpen}
                aria-controls="workflow-node-inspector"
                onClick={() => {
                  if (inspectorOpen) {
                    setInspectorOpen(false);
                  } else {
                    openInspector();
                  }
                }}
              >
                Inspector
              </button>
              <button
                type="button"
                className={`workflow-studio__button ${
                  validationIssues.length ? "workflow-studio__button--warning" : ""
                }`}
                aria-expanded={bottomPanelOpen}
                aria-controls="workflow-validation-panel"
                onClick={() => setBottomPanelOpen((open) => !open)}
              >
                {validationIssues.length
                  ? `Validation · ${validationIssues.length}`
                  : "Validation"}
              </button>
              {workflowId && workflowStatus === "Draft" && onActivateWorkflow && (
                <button
                  type="button"
                  className="node-preview__action-btn node-preview__action-btn--activate"
                  onClick={() => void onActivateWorkflow()}
                  disabled={isStatusActionPending || isSaving}
                >
                  {isStatusActionPending ? "Activating…" : "Activate"}
                </button>
              )}
              {workflowId && workflowStatus === "Active" && onPauseWorkflow && (
                <button
                  type="button"
                  className="node-preview__action-btn node-preview__action-btn--pause"
                  onClick={() => void onPauseWorkflow()}
                  disabled={isStatusActionPending || isSaving}
                >
                  {isStatusActionPending ? "Pausing…" : "Pause"}
                </button>
              )}
              {workflowId && workflowStatus === "Paused" && onResumeWorkflow && (
                <button
                  type="button"
                  className="node-preview__action-btn node-preview__action-btn--resume"
                  onClick={() => void onResumeWorkflow()}
                  disabled={isStatusActionPending || isSaving}
                >
                  {isStatusActionPending ? "Resuming…" : "Resume"}
                </button>
              )}
              {onSaveGraph && (
                <button
                  type="button"
                  className="node-preview__save-btn"
                  onClick={() => void handleSave()}
                  disabled={isSaving || isStatusActionPending || !draftName.trim()}
                >
                  {isSaving
                    ? "Saving…"
                    : workflowId
                      ? "Save changes"
                      : "Save workflow"}
                </button>
              )}
            </div>
          </header>

          {(saveError || saveMessage || statusActionError || statusActionMessage) && (
            <div className="workflow-studio__notices">
              {statusActionError && (
                <div className="node-preview__save-alert node-preview__save-alert--error" role="alert">
                  {statusActionError}
                </div>
              )}
              {statusActionMessage && (
                <div className="node-preview__save-alert node-preview__save-alert--success" role="status">
                  {statusActionMessage}
                </div>
              )}
              {saveError && (
                <div className="node-preview__save-alert node-preview__save-alert--error" role="alert">
                  {saveError}
                </div>
              )}
              {saveMessage && (
                <div className="node-preview__save-alert node-preview__save-alert--success" role="status">
                  {saveMessage}
                </div>
              )}
            </div>
          )}

          <div className="workflow-studio__stage">
            <div
              ref={reactFlowWrapper}
              className="workflow-studio__canvas"
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
                onNodeClick={(_, node) => {
                  setSelectedNodeId(node.id)
                  setSelectedEdgeId(null)
                  openInspector()
                }}
                onEdgeClick={(_, edge) => {
                  setSelectedEdgeId(edge.id)
                  setSelectedNodeId(null)
                  openInspector()
                }}
                onPaneClick={clearSelection}
                deleteKeyCode={["Backspace", "Delete"]}
                defaultEdgeOptions={{ type: "smoothstep" }}
                fitView
              >
                <Background gap={22} size={1} color="#cbd5e1" />
                <Controls position="bottom-left" />
                <MiniMap
                  position="bottom-right"
                  nodeColor={(node) =>
                    node.type === "trigger"
                      ? "#059669"
                      : node.type === "condition"
                        ? "#d97706"
                        : "#2563eb"
                  }
                />
              </ReactFlow>

              {nodes.length === 0 && (
                <div className="workflow-studio__empty-canvas">
                  <strong>Start building your workflow</strong>
                  <span>Add a trigger, task, or condition from the node panel.</span>
                  <button type="button" onClick={() => addNode("trigger")}>
                    Add trigger
                  </button>
                </div>
              )}

              {paletteOpen && (
                <aside
                  className="workflow-studio__panel workflow-studio__palette"
                  id="workflow-node-palette"
                  aria-label="Node palette"
                >
                  <div className="workflow-studio__panel-heading">
                    <div>
                      <span className="workflow-studio__panel-eyebrow">Workflow</span>
                      <h2>Node library</h2>
                    </div>
                    <button
                      type="button"
                      className="workflow-studio__icon-button"
                      aria-label="Collapse node library"
                      onClick={() => setPaletteOpen(false)}
                    >
                      ×
                    </button>
                  </div>
                  <label className="workflow-studio__search-label" htmlFor="workflow-node-search">
                    Search nodes
                  </label>
                  <input
                    id="workflow-node-search"
                    className="node-preview__input"
                    type="search"
                    value={nodeSearch}
                    onChange={(event) => setNodeSearch(event.target.value)}
                    placeholder="Search node types"
                  />
                  <div className="workflow-studio__node-list">
                    {filteredNodeTypes.map((item) => {
                      const triggerUnavailable =
                        item.type === "trigger" && hasTrigger;
                      return (
                        <button
                          key={item.type}
                          type="button"
                          className={`workflow-studio__node-option workflow-studio__node-option--${item.type}`}
                          draggable={!triggerUnavailable}
                          disabled={triggerUnavailable}
                          title={
                            triggerUnavailable
                              ? "A workflow can have only one trigger."
                              : `Click to add or drag ${item.title} onto the canvas`
                          }
                          onDragStart={(event) =>
                            onDragStart(event, item.type)
                          }
                          onClick={() => addNode(item.type)}
                        >
                          <span className="workflow-studio__node-icon" aria-hidden="true">
                            {item.icon}
                          </span>
                          <span className="workflow-studio__node-copy">
                            <strong>{item.title}</strong>
                            <small>
                              {triggerUnavailable
                                ? "Only one trigger is allowed"
                                : item.description}
                            </small>
                          </span>
                          <span className="workflow-studio__drag-mark" aria-hidden="true">⠿</span>
                        </button>
                      );
                    })}
                    {filteredNodeTypes.length === 0 && (
                      <p className="workflow-studio__empty-search" role="status">
                        No node types match “{nodeSearch}”.
                      </p>
                    )}
                  </div>
                </aside>
              )}

              {inspectorOpen && (
                <aside
                  className="workflow-studio__panel workflow-studio__inspector"
                  id="workflow-node-inspector"
                  aria-label="Selection inspector"
                  aria-live="polite"
                >
                  <div className="workflow-studio__panel-heading">
                    <div>
                      <span className="workflow-studio__panel-eyebrow">
                        {selectedEdge ? "Connection" : "Configuration"}
                      </span>
                      <h2>
                        {selectedNode
                          ? NODE_KIND_LABEL[selectedNode.data.type]
                          : selectedEdge
                            ? "Selected edge"
                            : "Inspector"}
                      </h2>
                    </div>
                    <div className="workflow-studio__inspector-actions">
                      {(selectedNode || selectedEdge) && (
                        <button
                          type="button"
                          className="workflow-studio__icon-button"
                          aria-label="Clear selection"
                          onClick={clearSelection}
                        >
                          ↗
                        </button>
                      )}
                      <button
                        type="button"
                        className="workflow-studio__icon-button"
                        aria-label="Close inspector"
                        onClick={() => setInspectorOpen(false)}
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {selectedNode ? (
                    <>
                      <h3 className="node-preview__details-title">
                        {selectedNode.data.label}
                      </h3>
                      <dl className="node-preview__property-list">
                        <div className="node-preview__property-row">
                          <dt>Node ID</dt>
                          <dd><code>{selectedNode.id}</code></dd>
                        </div>
                        <div className="node-preview__property-row">
                          <dt>Position</dt>
                          <dd>
                            x: {Math.round(selectedNode.position.x)}, y:{" "}
                            {Math.round(selectedNode.position.y)}
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
                      {selectedNode.data.type === "condition" ? (
                        <ConditionConfigEditor
                          key={`config-${selectedNode.id}`}
                          node={selectedNode}
                          onApply={applyConditionConfig}
                        />
                      ) : (
                        <NodeConfigEditor
                          key={`config-${selectedNode.id}`}
                          node={selectedNode}
                          onApply={applyConditionConfig}
                        />
                      )}
                      <button
                        type="button"
                        className="workflow-studio__delete-button"
                        onClick={removeSelectedNode}
                      >
                        Delete node
                      </button>
                    </>
                  ) : selectedEdge ? (
                    <>
                      <dl className="node-preview__property-list">
                        <div className="node-preview__property-row">
                          <dt>Edge ID</dt>
                          <dd><code>{selectedEdge.id}</code></dd>
                        </div>
                        <div className="node-preview__property-row">
                          <dt>From</dt>
                          <dd>{nodes.find((node) => node.id === selectedEdge.source)?.data.label ?? selectedEdge.source}</dd>
                        </div>
                        <div className="node-preview__property-row">
                          <dt>To</dt>
                          <dd>{nodes.find((node) => node.id === selectedEdge.target)?.data.label ?? selectedEdge.target}</dd>
                        </div>
                        {selectedEdge.sourceHandle && (
                          <div className="node-preview__property-row">
                            <dt>Branch</dt>
                            <dd>{selectedEdge.sourceHandle === "true" ? "True" : selectedEdge.sourceHandle === "false" ? "False" : selectedEdge.sourceHandle}</dd>
                          </div>
                        )}
                      </dl>
                      <button
                        type="button"
                        className="workflow-studio__delete-button"
                        onClick={removeSelectedEdge}
                      >
                        Delete connection
                      </button>
                    </>
                  ) : (
                    <div className="node-preview__empty-selection">
                      <p className="node-preview__note">
                        Select a node or connection on the canvas to inspect its supported properties.
                      </p>
                    </div>
                  )}
                </aside>
              )}
            </div>

            <section
              className={`workflow-studio__validation ${
                bottomPanelOpen ? "is-open" : ""
              }`}
              id="workflow-validation-panel"
              aria-label="Workflow validation"
            >
              <button
                type="button"
                className="workflow-studio__validation-toggle"
                aria-expanded={bottomPanelOpen}
                onClick={() => setBottomPanelOpen((open) => !open)}
              >
                <span
                  className={`workflow-studio__validation-indicator ${
                    validationIssues.length ? "has-issues" : ""
                  }`}
                />
                <span>
                  {validationIssues.length
                    ? `${validationIssues.length} validation ${
                        validationIssues.length === 1 ? "issue" : "issues"
                      }`
                    : "Workflow validation"}
                </span>
                <span className="workflow-studio__validation-summary">
                  {validationIssues.length
                    ? "Review graph contract"
                    : "No graph contract issues"}
                </span>
                <span aria-hidden="true">{bottomPanelOpen ? "−" : "+"}</span>
              </button>
              {bottomPanelOpen && (
                <div className="workflow-studio__validation-content">
                  {connectionError && (
                    <p className="workflow-studio__connection-error" role="alert">
                      {connectionError}
                    </p>
                  )}
                  {validationIssues.length ? (
                    <ul className="workflow-studio__issue-list" role="alert">
                      {validationIssues.map((issue) => (
                        <li key={`${issue.message}-${issue.nodeId ?? ""}`}>
                          <span>{issue.message}</span>
                          {issue.nodeId && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedEdgeId(null);
                                setSelectedNodeId(issue.nodeId ?? null);
                                openInspector();
                                setNodes((currentNodes) =>
                                  currentNodes.map((node) => ({
                                    ...node,
                                    selected: node.id === issue.nodeId,
                                  })),
                                );
                              }}
                            >
                              Focus node
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p role="status">
                      The current graph passes the existing version 1 contract checks.
                    </p>
                  )}
                  <details className="node-preview__payload">
                    <summary>View serialized graph</summary>
                    <pre>{JSON.stringify(graphPayload, null, 2)}</pre>
                  </details>
                </div>
              )}
            </section>
          </div>
        </div>
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
