# Workflow Graph Contract

## Status

This document describes the agreed workflow graph structure and validation rules. Node-specific configuration validation is pending Nithin's complete specification.

## 1. Stored Graph Payload

The stored graph format is `{ version: 1, nodes, edges }`. Save the React Flow graph in this format without replacing it with an ExecutionSpec.

## 2. Node Types

Supported node types:

- `trigger`

- `task`

- `condition`

Each node contains:

- `id`: unique, non-empty identifier

- `type`: supported node type

- `position`: finite numeric `x` and `y`

- `data.type`: must match the top-level `type`

- `data.label`: non-empty string

The current frontend `WorkflowNodeData` type defines only `type` and `label`. Do not assume additional configuration fields until the team confirms them.

## 3. Edges and Conditional Branching

Each edge contains:

- `id`: unique, non-empty identifier

- `source`: existing source node ID

- `target`: existing target node ID

- `sourceHandle`: optional source handle

Condition branches use the exact, case-sensitive handles `true` and `false`. Every condition must have both outgoing branches.

The inspected backend interface does not currently declare `version`, `targetHandle`, or edge `data`. Confirm whether the latter two are required before adding them to the contract.

## 4. Agreed Validation Rules

The graph must:

1. Have `version: 1`.

2. Contain `nodes` and `edges` arrays.

3. Use supported node types.

4. Have unique, non-empty node and edge IDs.

5. Have finite numeric node positions.

6. Have matching `type` and `data.type`.

7. Have non-empty node labels.

8. Reference existing nodes from every edge.

9. Contain exactly one trigger.

10. Have both true and false outgoing branches for every condition.

11. Contain no directed cycles.

## 5. Configuration Validation

The complete configuration schema for trigger, task, and condition nodes has not been located in the inspected files. Do not invent configuration fields.

Cron parsing and IANA timezone validation must follow the team's confirmed specification.

## 6. Current Backend Gaps

The inspected backend validator checks arrays, identifiers, supported node types, matching node data types, labels, finite positions, edge endpoints, supplied condition source handles, and directed cycles.

It does not currently enforce:

- Graph version `1`

- Exactly one trigger

- Both condition branches

- Node-specific configuration validation

These are gaps between the agreed contract and the inspected implementation, not claims that validation is complete. Coordinate implementation changes with the backend owner.

## 7. Save and Security

The frontend should validate the graph before Save and provide clear error feedback. The backend must validate independently before persistence or execution.

Tenant authorization must come from trusted server-side authentication context, never from graph data or a client-supplied tenant ID.

The exact save endpoint and response format must follow the team's agreed API contract.

## 8. Pending Confirmation

- Complete configuration schemas for each node type

- Applicable cron and timezone requirements

- Whether `targetHandle` and edge `data` are required

- Alignment of frontend and backend graph types

- Final validation error-response format


