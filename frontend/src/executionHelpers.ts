import type { WorkflowExecution } from './api/executionApi'
import type { ExecutionUpdateEvent } from './api/executionRealtime'

export function sanitizeErrorMessage(message: string): string {
  if (!message || !message.trim()) {
    return 'An unexpected error occurred.'
  }

  const cleaned = message
    .replace(/https?:\/\/\S+/gi, '[technical details hidden]')
    .replace(/(?:\r?\n)?\s*at\s+(?:[A-Za-z0-9_$.<>]+\s+\()?[\w./\\-]+:\d+(?::\d+)?\)?/gi, ' [technical details hidden]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (!cleaned || cleaned === '[technical details hidden]') {
    return 'An unexpected error occurred.'
  }

  return cleaned.length > 240
    ? `${cleaned.slice(0, 237)}...`
    : cleaned
}

export function getErrorText(error: WorkflowExecution['error']): string {
  if (!error) return ''

  const message =
    typeof error === 'string'
      ? error
      : typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message ?? '')
        : ''

  if (!message.trim()) return ''

  return sanitizeErrorMessage(message)
}

export function isValidExecutionId(id: string): boolean {
  return /^[a-f\d]{24}$/i.test(id)
}

export type ActiveExecutionFilters = {
  selectedWorkflowId?: string
  statusFilter?: string
  fromDate?: string
  toDate?: string
  searchExecutionId?: string
}

export function matchesExecutionFilters(
  record: WorkflowExecution,
  filters: ActiveExecutionFilters,
): boolean {
  if (
    filters.searchExecutionId &&
    String(record.id ?? record._id ?? '') !== filters.searchExecutionId
  ) {
    return false
  }

  if (
    filters.selectedWorkflowId &&
    String(record.workflowId) !== filters.selectedWorkflowId
  ) {
    return false
  }

  if (filters.statusFilter && record.status !== filters.statusFilter) {
    return false
  }

  const dateStr = record.createdAt ?? record.startedAt
  const recordDate = dateStr ? new Date(dateStr) : null

  if (filters.fromDate) {
    const fromTime = new Date(filters.fromDate).getTime()
    if (!recordDate || recordDate.getTime() < fromTime) {
      return false
    }
  }

  if (filters.toDate) {
    const toDateStr = filters.toDate.includes('T')
      ? filters.toDate
      : `${filters.toDate}T23:59:59.999Z`
    const toTime = new Date(toDateStr).getTime()
    if (!recordDate || recordDate.getTime() > toTime) {
      return false
    }
  }

  return true
}

export function applyRealtimeExecutionUpdate(
  current: WorkflowExecution[],
  event: ExecutionUpdateEvent,
): { updatedList: WorkflowExecution[]; wasFound: boolean } {
  let wasFound = false
  const targetId = event.data.executionId

  const updatedList = current.map((item) => {
    const id = item.id ?? item._id
    if (id !== targetId) {
      return item
    }
    wasFound = true
    return {
      ...item,
      status: event.data.status,
      updatedAt: event.data.updatedAt,
    }
  })

  if (!wasFound) {
    return { updatedList: current, wasFound: false }
  }

  return { updatedList, wasFound }
}

export function insertIngestedExecution(
  current: WorkflowExecution[],
  record: WorkflowExecution,
): WorkflowExecution[] {
  const targetId = record.id ?? record._id
  if (current.some((item) => (item.id ?? item._id) === targetId)) {
    return current.map((item) => ((item.id ?? item._id) === targetId ? record : item))
  }

  const combined = [record, ...current]
  combined.sort((a, b) => {
    const timeA = new Date(a.createdAt ?? a.startedAt ?? 0).getTime()
    const timeB = new Date(b.createdAt ?? b.startedAt ?? 0).getTime()
    if (timeA !== timeB) return timeB - timeA
    const idA = String(a.id ?? a._id ?? '')
    const idB = String(b.id ?? b._id ?? '')
    return idB.localeCompare(idA)
  })
  return combined
}

export interface ExecutionDrawerState {
  isOpen: boolean
  selectedId: string
  loadingId: string
  error: string
  details: WorkflowExecution | null
}

export function createInitialDrawerState(): ExecutionDrawerState {
  return {
    isOpen: false,
    selectedId: '',
    loadingId: '',
    error: '',
    details: null,
  }
}

export function openDrawerForExecution(
  currentState: ExecutionDrawerState,
  executionId: string,
): ExecutionDrawerState {
  return {
    ...currentState,
    isOpen: true,
    selectedId: executionId,
    loadingId: executionId,
    error: '',
    details: null,
  }
}

export function closeDrawerState(): ExecutionDrawerState {
  return {
    isOpen: false,
    selectedId: '',
    loadingId: '',
    error: '',
    details: null,
  }
}

/**
 * Formats a percentage value (0–100 scale) returned by the backend analytics API.
 * e.g. 100 -> '100%', 82.35 -> '82.35%', 0 -> '0%', null/undefined/NaN -> '—'.
 */
export function formatPercentage(percentage: number | null | undefined): string {
  if (percentage === null || percentage === undefined || Number.isNaN(percentage)) {
    return '—'
  }
  if (percentage === 0) {
    return '0%'
  }
  const formatted = Number(percentage.toFixed(2))
  return `${formatted}%`
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms) || ms < 0) {
    return '—'
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`
  }
  if (ms < 3600000) {
    const mins = Math.floor(ms / 60000)
    const secs = Math.round((ms % 60000) / 1000)
    return `${mins}m ${secs}s`
  }
  const hrs = Math.floor(ms / 3600000)
  const mins = Math.floor((ms % 3600000) / 60000)
  return `${hrs}h ${mins}m`
}

export function calculateCurrentlyRunning(
  summary: { running?: number; compensating?: number } | null | undefined,
): number {
  if (!summary) return 0
  return (summary.running ?? 0) + (summary.compensating ?? 0)
}

export interface NodeDurationResult {
  durationMs: number | null
  durationText: string
  isValid: boolean
}

/**
 * Calculates and formats duration between startedAt and completedAt.
 * If either timestamp is missing, invalid, or completedAt < startedAt, returns 'Duration unavailable'.
 */
export function formatNodeDuration(
  startedAt?: string | Date | null,
  completedAt?: string | Date | null,
): NodeDurationResult {
  if (!startedAt || !completedAt) {
    return { durationMs: null, durationText: 'Duration unavailable', isValid: false }
  }

  const start = new Date(startedAt).getTime()
  const end = new Date(completedAt).getTime()

  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return { durationMs: null, durationText: 'Duration unavailable', isValid: false }
  }

  const durationMs = end - start

  let durationText: string
  if (durationMs < 1000) {
    durationText = `${Math.round(durationMs)} ms`
  } else if (durationMs < 60000) {
    durationText = `${(durationMs / 1000).toFixed(1)} s`
  } else {
    const mins = Math.floor(durationMs / 60000)
    const secs = Math.round((durationMs % 60000) / 1000)
    durationText = `${mins} minute${mins !== 1 ? 's' : ''} ${secs} second${secs !== 1 ? 's' : ''}`
  }

  return { durationMs, durationText, isValid: true }
}

export interface TimelineNodeStep {
  stepNumber: number
  nodeId: string
  label: string
  nodeType?: string
  status: 'completed' | 'failed' | 'skipped' | string
  durationMs: number | null
  durationText: string
  hasValidDuration: boolean
  isSlowest: boolean
  error?: string
  compensation?: {
    status: string
    startedAt?: string | null
    completedAt?: string | null
    durationText: string
    error?: string
  }
  output?: unknown
}

export interface ExecutionTimelineData {
  startedAt: string | null
  completedAt: string | null
  totalDurationMs: number | null
  totalDurationText: string
  executionStatus: string
  steps: TimelineNodeStep[]
  slowestNode: TimelineNodeStep | null
  hasAnyValidNodeDuration: boolean
  failedStep: TimelineNodeStep | null
}

/**
 * Transforms an execution and its graph snapshot into a visual timeline model.
 * Preserves actual sequential execution order from nodeResults.
 */
export function buildExecutionTimeline(
  execution: WorkflowExecution | null | undefined,
): ExecutionTimelineData {
  if (!execution) {
    return {
      startedAt: null,
      completedAt: null,
      totalDurationMs: null,
      totalDurationText: 'Duration unavailable',
      executionStatus: 'queued',
      steps: [],
      slowestNode: null,
      hasAnyValidNodeDuration: false,
      failedStep: null,
    }
  }

  const totalTiming = formatNodeDuration(execution.startedAt, execution.completedAt)

  // Map graph snapshot nodes for friendly labels and node types
  const nodeLabelMap = new Map<string, { label: string; type?: string }>()
  if (execution.graphSnapshot?.nodes && Array.isArray(execution.graphSnapshot.nodes)) {
    for (const node of execution.graphSnapshot.nodes) {
      if (node && typeof node.id === 'string') {
        nodeLabelMap.set(node.id, {
          label: node.data?.label?.trim() || node.id,
          type: node.type,
        })
      }
    }
  }

  const nodeResults = Array.isArray(execution.nodeResults) ? execution.nodeResults : []
  const steps: TimelineNodeStep[] = []
  let failedStep: TimelineNodeStep | null = null

  for (let i = 0; i < nodeResults.length; i++) {
    const nr = nodeResults[i]
    if (!nr || typeof nr.nodeId !== 'string') continue

    const meta = nodeLabelMap.get(nr.nodeId)
    const label = meta?.label || nr.nodeId
    const nodeType = meta?.type || 'task'

    const nodeTiming = formatNodeDuration(nr.startedAt, nr.completedAt)

    let compData: TimelineNodeStep['compensation'] = undefined
    if (nr.compensation) {
      const compTiming = formatNodeDuration(
        nr.compensation.startedAt,
        nr.compensation.completedAt,
      )
      const compErrorMsg =
        typeof nr.compensation.error === 'string'
          ? nr.compensation.error
          : typeof nr.compensation.error === 'object' &&
              nr.compensation.error !== null &&
              'message' in nr.compensation.error
            ? String((nr.compensation.error as { message?: unknown }).message ?? '')
            : undefined

      compData = {
        status: nr.compensation.status,
        startedAt: nr.compensation.startedAt ? String(nr.compensation.startedAt) : null,
        completedAt: nr.compensation.completedAt ? String(nr.compensation.completedAt) : null,
        durationText: compTiming.durationText,
        error: compErrorMsg ? sanitizeErrorMessage(compErrorMsg) : undefined,
      }
    }

    const errorMsg =
      typeof nr.error === 'string'
        ? nr.error
        : typeof nr.error === 'object' && nr.error !== null && 'message' in nr.error
          ? String((nr.error as { message?: unknown }).message ?? '')
          : undefined

    const step: TimelineNodeStep = {
      stepNumber: i + 1,
      nodeId: nr.nodeId,
      label,
      nodeType,
      status: nr.status,
      durationMs: nodeTiming.durationMs,
      durationText: nodeTiming.durationText,
      hasValidDuration: nodeTiming.isValid,
      isSlowest: false,
      error: errorMsg ? sanitizeErrorMessage(errorMsg) : undefined,
      compensation: compData,
      output: nr.output,
    }

    if (nr.status === 'failed' && !failedStep) {
      failedStep = step
    }

    steps.push(step)
  }

  // Find slowest node only if at least one node has a valid positive duration
  const validDurationSteps = steps.filter(
    (s) => s.hasValidDuration && s.durationMs !== null && s.durationMs > 0,
  )

  let slowestNode: TimelineNodeStep | null = null
  if (validDurationSteps.length > 0) {
    slowestNode = validDurationSteps.reduce((max, curr) =>
      (curr.durationMs ?? 0) > (max.durationMs ?? 0) ? curr : max,
    )
    slowestNode.isSlowest = true
  }

  return {
    startedAt: execution.startedAt ? String(execution.startedAt) : null,
    completedAt: execution.completedAt ? String(execution.completedAt) : null,
    totalDurationMs: totalTiming.durationMs,
    totalDurationText: totalTiming.durationText,
    executionStatus: execution.status,
    steps,
    slowestNode,
    hasAnyValidNodeDuration: validDurationSteps.length > 0,
    failedStep,
  }
}

