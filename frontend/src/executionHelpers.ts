import type { WorkflowExecution } from './api/executionApi'

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

