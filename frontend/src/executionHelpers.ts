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

export function formatPercentage(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) {
    return '—'
  }
  if (ratio === 0) {
    return '0%'
  }
  const pct = ratio * 100
  const formatted = Number(pct.toFixed(2))
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

