
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
    data?: unknown
  }>
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
