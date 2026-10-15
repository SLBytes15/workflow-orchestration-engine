
import { useCallback, useEffect, useMemo } from "react";
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

type NodePreviewProps = {
  onGraphChange?: (graph: WorkflowGraph) => void;
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
      label: "Payment method",
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

function NodePreview({ onGraphChange }: NodePreviewProps) {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const graphPayload: WorkflowGraph = useMemo(
    () => ({
      version: 1,
      nodes: nodes.map((node) => ({
        id: node.id,
        type: node.type as "trigger" | "task" | "condition",
        position: node.position,
        data: {
          ...node.data,
          type: node.type as "trigger" | "task" | "condition",
          label: String(node.data.label ?? ""),
        },
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.sourceHandle !== null
          ? { sourceHandle: edge.sourceHandle }
          : {}),
        ...(edge.targetHandle !== null
          ? { targetHandle: edge.targetHandle }
          : {}),
        ...(edge.data !== undefined ? { data: edge.data } : {}),
      })),
    }),
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

  return (
    <section className="node-preview">
      <h2>Workflow Node Preview</h2>
      <p>Connect nodes to preview your workflow structure.</p>

      <div style={{ width: "100%", height: "500px" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </section>
  );
}

export default NodePreview;
