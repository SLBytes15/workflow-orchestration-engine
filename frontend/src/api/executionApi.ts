
const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'
).replace(/\/+$/, '')

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'

export type ExecutionNodeResult = {
  nodeId: string
  status: 'completed' | 'failed' | 'skipped'
  output?: unknown
  error?: { code?: string; message?: string } | string
}

export type WorkflowExecution = {
  id?: string
  _id?: string
  workflowId: string
  workflowVersion?: number
  status: ExecutionStatus
  currentNodeId?: string | null
  nodeResults?: ExecutionNodeResult[]
  error?: { code?: string; message?: string } | string | null
  startedAt?: string | null
  completedAt?: string | null
  createdAt?: string
}

export type ExecutionHistoryResponse = {
  message?: string
  executions: WorkflowExecution[]
  pagination: {
    limit: number
    hasMore: boolean
    nextCursor: string | null
  }
}

type ApiErrorResponse = {
  error?: {
    code?: string
    message?: string
    details?: string[]
  }
}

function getErrorMessage(
  body: ApiErrorResponse | null,
  status: number,
): string {
  return (
    body?.error?.message ??
    `Execution API request failed (HTTP ${status}).`
  )
}

async function request<T>(
  path: string,
  apiKey: string,
): Promise<T> {
  if (!apiKey.trim()) {
    throw new Error('API authentication is not configured.')
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'X-API-Key': apiKey },
  })

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      getErrorMessage(body as ApiErrorResponse | null, response.status),
    )
  }

  return body as T
}

export async function startExecution(
  workflowId: string,
  apiKey: string,
): Promise<WorkflowExecution> {
  if (!apiKey.trim()) {
    throw new Error('API authentication is not configured.')
  }

  const response = await fetch(
    `${API_BASE_URL}/api/workflows/${encodeURIComponent(workflowId)}/executions`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
    },
  )

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      getErrorMessage(body as ApiErrorResponse | null, response.status),
    )
  }

  const payload = body as {
    execution?: WorkflowExecution
    id?: string
    _id?: string
    workflowId?: string
    status?: ExecutionStatus
  } | null

  const execution = payload?.execution ?? payload

  if (!execution?.workflowId || !execution.status) {
    throw new Error('The API returned an invalid execution response.')
  }

  return execution as WorkflowExecution
}

export async function getWorkflowExecutions(
  workflowId: string,
  apiKey: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<ExecutionHistoryResponse> {
  const params = new URLSearchParams()
  params.set('limit', String(options.limit ?? 20))

  if (options.cursor) {
    params.set('cursor', options.cursor)
  }

  const result = await request<ExecutionHistoryResponse>(
    `/api/workflows/${encodeURIComponent(workflowId)}/executions?${params}`,
    apiKey,
  )

  if (
    !Array.isArray(result.executions) ||
    !result.pagination ||
    typeof result.pagination.hasMore !== 'boolean'
  ) {
    throw new Error('The API returned an invalid execution history response.')
  }

  return result
}

export async function getExecution(
  executionId: string,
  apiKey: string,
): Promise<WorkflowExecution> {
  const result = await request<
    { execution: WorkflowExecution } | WorkflowExecution
  >(`/api/executions/${encodeURIComponent(executionId)}`, apiKey)

  const execution =
    'execution' in result ? result.execution : result

  if (!execution?.workflowId || !execution.status) {
    throw new Error('The API returned an invalid execution details response.')
  }

  return execution
}
