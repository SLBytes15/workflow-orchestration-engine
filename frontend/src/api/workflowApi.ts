
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

export async function createWorkflow(
  input: CreateWorkflowRequest,
  tenantApiKey: string,
) {
  const response = await fetch('http://localhost:3000/api/workflows', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': tenantApiKey,
    },
    body: JSON.stringify(input),
  })

 if (!response.ok) {
  const result = await response.json().catch(() => null)

  const details = result?.error?.details

  if (Array.isArray(details) && details.length > 0) {
    throw new Error(details.join('\n'))
  }

  throw new Error(
    result?.error?.message ??
      `Create workflow failed (HTTP ${response.status})`,
  )
}

  return response.json()
}
