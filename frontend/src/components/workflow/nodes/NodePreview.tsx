import { useCallback, useMemo, useState } from "react";
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import ConditionNode from "./ConditionNode";
import TaskNode from "./TaskNode";
import TriggerNode from "./TriggerNode";
import {
  HANDLE,
  NODE_KIND_LABEL,
  type WorkflowFlowEdge,
  type WorkflowFlowNode,
  type WorkflowGraph,
} from "./node.types";
import "./node.css";

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  task: TaskNode,
  condition: ConditionNode,
};

/**
 * Sample graph demonstrating the agreed contract:
 *   trigger-1 ──► condition-1
 *                      ├─ true  ──► task-approved
 *                      └─ false ──► task-rejected
 *
 * Condition sourceHandles are literally "true" and "false" — the only
 * routing mechanism the execution engine uses. No fake persistence or
 * execution lives here; the canvas only edits the graph.
 */
const initialNodes: WorkflowFlowNode[] = [
  {
    id: "trigger-1",
    type: "trigger",
    position: { x: 80, y: 200 },
    data: { type: "trigger", label: "Order created" },
  },
  {
    id: "condition-1",
    type: "condition",
    position: { x: 380, y: 200 },
    data: { type: "condition", label: "Payment approved?" },
  },
  {
    id: "task-approved",
    type: "task",
    position: { x: 720, y: 100 },
    data: { type: "task", label: "Complete order" },
  },
  {
    id: "task-rejected",
    type: "task",
    position: { x: 720, y: 320 },
    data: { type: "task", label: "Reject order" },
  },
];

const initialEdges: WorkflowFlowEdge[] = [
  {
    id: "edge-trigger-condition",
    source: "trigger-1",
    target: "condition-1",
    sourceHandle: HANDLE.source,
    targetHandle: HANDLE.target,
  },
  {
    id: "edge-condition-true",
    source: "condition-1",
    target: "task-approved",
    sourceHandle: HANDLE.branchTrue,
    targetHandle: HANDLE.target,
    label: "true",
  },
  {
    id: "edge-condition-false",
    source: "condition-1",
    target: "task-rejected",
    sourceHandle: HANDLE.branchFalse,
    targetHandle: HANDLE.target,
    label: "false",
  },
];

function NodePreview() {
  const [nodes, , onNodesChange] =
    useNodesState<WorkflowFlowNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] =
    useEdgesState<WorkflowFlowEdge>(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    "trigger-1",
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  // `addEdge` preserves connection.sourceHandle automatically, so condition
  // branch handles survive a round-trip without extra wiring.
  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) => addEdge(connection, current));
    },
    [setEdges],
  );

  // The canvas does not transform the graph before showing it; the
  // payload displayed in the UI is what would be sent to the API.
  const graphPayload: WorkflowGraph = useMemo(
    () => ({ version: 1, nodes, edges }),
    [nodes, edges],
  );

  return (
    <section className="node-preview" aria-labelledby="node-preview-title">
      <div className="node-preview__heading">
        <div>
          <p className="node-preview__eyebrow">Editor foundation</p>
          <h2 id="node-preview-title">Interactive workflow canvas</h2>
        </div>
        <p className="node-preview__hint">
          Connect nodes and inspect the graph payload.
        </p>
      </div>

      <div className="node-preview__workspace">
        <div
          className="node-preview__canvas"
          aria-label="Workflow graph canvas"
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            fitView
            nodesConnectable
            edgesReconnectable
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
                  <dt>Node id</dt>
                  <dd>{selectedNode.id}</dd>
                </div>
                <div>
                  <dt>Outgoing edges</dt>
                  <dd>
                    {
                      edges.filter((e) => e.source === selectedNode.id)
                        .length
                    }
                  </dd>
                </div>
                {selectedNode.data.type === "condition" && (
                  <div>
                    <dt>Branch handles</dt>
                    <dd>true, false</dd>
                  </div>
                )}
              </dl>
            </>
          ) : (
            <p className="node-preview__hint">No node selected.</p>
          )}

          <p className="node-preview__note">
            Configuration validation is pending the agreed config
            specification; structural rules are enforced server-side.
          </p>
          <details className="node-preview__payload">
            <summary>Current graph payload</summary>
            <pre>{JSON.stringify(graphPayload, null, 2)}</pre>
          </details>
        </aside>
      </div>
    </section>
  );
}

export default NodePreview;
