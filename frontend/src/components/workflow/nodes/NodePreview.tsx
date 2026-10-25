
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
  initialGraph?: WorkflowGraph | null;
  onSaveGraph?: (graph: WorkflowGraph) => void | Promise<void>;
  isSaving?: boolean;
  saveError?: string;
  saveMessage?: string;
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

function NodePreview({
  onGraphChange,
  initialGraph,
  onSaveGraph,
  isSaving = false,
  saveError = "",
  saveMessage = "",
}: NodePreviewProps) {
  const [nodes, , onNodesChange] = useNodesState(
    (initialGraph?.nodes as Node[] | undefined) ?? initialNodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    (initialGraph?.edges as Edge[] | undefined) ?? initialEdges,
  );

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
