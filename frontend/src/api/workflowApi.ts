
export type WorkflowGraph = {
  version: 1
  nodes: Array<{
    id: string
    type: 'trigger' | 'task' | 'condition'
    position: { x: number; y: number }
    data: {
      type: 'trigger' | 'task' | 'condition'
      label: string
      [key: string]: unknown
    }
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
    data?: Record<string, unknown>
  }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isWorkflowGraph(value: unknown): value is WorkflowGraph {
  if (
    !isRecord(value) ||
    !('version' in value) ||
    value.version !== 1 ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges)
  ) {
    return false
  }

  return value.nodes.every(
    (node) =>
      isRecord(node) &&
      typeof node.id === 'string' &&
      node.id.trim().length > 0 &&
      (node.type === 'trigger' ||
        node.type === 'task' ||
        node.type === 'condition') &&
      isRecord(node.position) &&
      typeof node.position.x === 'number' &&
      Number.isFinite(node.position.x) &&
      typeof node.position.y === 'number' &&
      Number.isFinite(node.position.y) &&
      isRecord(node.data) &&
      node.data.type === node.type &&
      typeof node.data.label === 'string',
  ) && value.edges.every(
    (edge) =>
      isRecord(edge) &&
      typeof edge.id === 'string' &&
      edge.id.trim().length > 0 &&
      typeof edge.source === 'string' &&
      edge.source.trim().length > 0 &&
      typeof edge.target === 'string' &&
      edge.target.trim().length > 0 &&
      (edge.sourceHandle === undefined ||
        typeof edge.sourceHandle === 'string') &&
      (edge.targetHandle === undefined ||
        typeof edge.targetHandle === 'string') &&
      (edge.data === undefined || isRecord(edge.data)),
  )
}

export type CreateWorkflowRequest = {
  name: string
  description?: string
  graph: WorkflowGraph
}

export type CreatedWorkflow = {
  id?: string
  _id?: string
  name?: string
  description?: string
  status?: string
  version?: number
  updatedAt?: string
  graph?: WorkflowGraph
  [key: string]: unknown
}

export type CreateWorkflowResponse = {
  message: string
  workflow: CreatedWorkflow
}

export type ListWorkflowsResponse = {
  message: string
  workflows: CreatedWorkflow[]
}

type WorkflowApiErrorResponse = {
  error?: {
    code?: string
    message?: string
    details?: string[]
  }
}

function getApiBaseUrl(): string {
  return (
    import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
  ).replace(/\/+$/, '')
}

function getApiErrorMessage(
  result: WorkflowApiErrorResponse | null,
  status: number,
): string {
  const details = result?.error?.details

  if (Array.isArray(details) && details.length > 0) {
    return details.join('\n')
  }

  return (
    result?.error?.message ??
    `Workflow API request failed (HTTP ${status})`
  )
}

export async function createWorkflow(
  input: CreateWorkflowRequest,
  tenantApiKey: string,
): Promise<CreateWorkflowResponse> {
  if (!tenantApiKey.trim()) {
    throw new Error('API authentication is not configured.')
  }

  const response = await fetch(`${getApiBaseUrl()}/api/workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': tenantApiKey,
    },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const result = (await response
      .json()
      .catch(() => null)) as WorkflowApiErrorResponse | null

    throw new Error(getApiErrorMessage(result, response.status))
  }

  return (await response.json()) as CreateWorkflowResponse
}

export async function getWorkflows(
  tenantApiKey: string,
): Promise<ListWorkflowsResponse> {
  if (!tenantApiKey.trim()) {
    throw new Error('API authentication is not configured.')
  }

  const response = await fetch(`${getApiBaseUrl()}/api/workflows`, {
    method: 'GET',
    headers: {
      'X-API-Key': tenantApiKey,
    },
  })

  if (!response.ok) {
    const result = (await response
      .json()
      .catch(() => null)) as WorkflowApiErrorResponse | null

    throw new Error(getApiErrorMessage(result, response.status))
  }

  return (await response.json()) as ListWorkflowsResponse
}

export async function updateWorkflowGraph(
  workflowId: string,
  graph: WorkflowGraph,
  tenantApiKey: string,
): Promise<CreateWorkflowResponse> {
  if (!tenantApiKey.trim()) {
    throw new Error('API authentication is not configured.')
  }

  const response = await fetch(
    `${getApiBaseUrl()}/api/workflows/${encodeURIComponent(workflowId)}/graph`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': tenantApiKey,
      },
      body: JSON.stringify({ graph }),
    },
  )

  if (!response.ok) {
    const result = (await response
      .json()
      .catch(() => null)) as WorkflowApiErrorResponse | null

    throw new Error(getApiErrorMessage(result, response.status))
  }

  const result = (await response.json()) as CreateWorkflowResponse
  if (!isWorkflowGraph(result.workflow?.graph)) {
    throw new Error(
      'The backend response did not contain the updated workflow graph.',
    )
  }

  return result
}

export async function deleteWorkflow(
  workflowId: string,
  tenantApiKey: string,
): Promise<void> {
  if (!tenantApiKey.trim()) {
    throw new Error('API authentication is not configured.')
  }

  const response = await fetch(
    `${getApiBaseUrl()}/api/workflows/${encodeURIComponent(workflowId)}`,
    {
      method: 'DELETE',
      headers: {
        'X-API-Key': tenantApiKey,
      },
    },
  )

  if (!response.ok) {
    const result = (await response
      .json()
      .catch(() => null)) as WorkflowApiErrorResponse | null

    throw new Error(getApiErrorMessage(result, response.status))
  }
}
