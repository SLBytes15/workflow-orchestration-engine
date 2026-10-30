import { useCallback, useEffect, useState, useRef } from 'react'
import { getWorkflows, type CreatedWorkflow } from '../api/workflowApi'
import {
  getExecution,
  getWorkflowExecutions,
  type WorkflowExecution,
} from '../api/executionApi'
import { connectExecutionUpdates } from '../api/executionRealtime'
import './ExecutionsPage.css'

type SavedWorkflow = {
  id: string
  name: string
}

const PAGE_SIZE = 20

function getId(item: CreatedWorkflow): string {
  return String(item.id ?? item._id ?? '')
}

function sanitizeErrorMessage(message: string): string {
  const cleaned = message
    .replace(/https?:\/\/\S+/gi, '[technical details hidden]')
    .replace(/\b(?:at\s+\S+.*)/gi, '[technical details hidden]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (!cleaned) {
    return 'An unexpected error occurred.'
  }

  return cleaned.length > 240
    ? `${cleaned.slice(0, 237)}...`
    : cleaned
}

function getErrorText(error: WorkflowExecution['error']): string {
  const message =
    typeof error === 'string'
      ? error
      : error?.message ?? ''

  return sanitizeErrorMessage(message)
}

function getStatusLabel(
  status: WorkflowExecution['status'] | string,
): string {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'running':
      return 'Running'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'compensating':
      return 'Compensating'
    case 'compensated':
      return 'Compensated'
    case 'compensation_failed':
      return 'Compensation failed'
    default:
      return 'Status unavailable'
  }
}

function getStatusClass(
  status: WorkflowExecution['status'] | string,
): string {
  switch (status) {
    case 'queued':
    case 'running':
    case 'completed':
    case 'failed':
    case 'compensating':
    case 'compensated':
    case 'compensation_failed':
      return `executions-page__status--${status}`
    default:
      return 'executions-page__status--unknown'
  }
}

function formatDate(value?: string | null): string {
  if (!value) return 'Not available'

  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? 'Invalid timestamp'
    : date.toLocaleString()
}

function getRequestError(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof Error) {
    return sanitizeErrorMessage(error.message)
  }

  return fallback
}

function ExecutionsPage({
  tenantApiKey,
}: {
  tenantApiKey?: string
}) {
  const [workflows, setWorkflows] = useState<SavedWorkflow[]>([])
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('')
  const [executions, setExecutions] = useState<WorkflowExecution[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const [loadingWorkflows, setLoadingWorkflows] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const [workflowError, setWorkflowError] = useState('')
  const [historyError, setHistoryError] = useState('')

  const [details, setDetails] = useState<WorkflowExecution | null>(null)
  const [detailsLoadingId, setDetailsLoadingId] = useState('')
  const [detailsError, setDetailsError] = useState('')

  const [refreshToken, setRefreshToken] = useState(0)
  const historyRequestId = useRef(0)
  const detailsRequestId = useRef(0)

  useEffect(() => {
    let cancelled = false

    async function loadWorkflows() {
      setLoadingWorkflows(true)
      setWorkflowError('')

      if (!tenantApiKey?.trim()) {
        setWorkflows([])
        setSelectedWorkflowId('')
        setWorkflowError('API authentication is not configured.')
        setLoadingWorkflows(false)
        return
      }

      try {
        const result = await getWorkflows(tenantApiKey)

        if (cancelled) return

        const saved = result.workflows
          .map((item) => ({
            id: getId(item),
            name: item.name?.trim() || 'Untitled workflow',
          }))
          .filter((item) => item.id.length > 0)

        setWorkflows(saved)

        setSelectedWorkflowId((current) =>
          saved.some((item) => item.id === current)
            ? current
            : saved[0]?.id ?? '',
        )
      } catch (error) {
        if (!cancelled) {
          setWorkflowError(
            getRequestError(error, 'Unable to load saved workflows.'),
          )
        }
      } finally {
        if (!cancelled) {
          setLoadingWorkflows(false)
        }
      }
    }

    void loadWorkflows()

    return () => {
      cancelled = true
    }
  }, [tenantApiKey])

  const loadHistory = useCallback(
    async (append: boolean, cursor?: string | null) => {
      const requestId = ++historyRequestId.current

      if (!tenantApiKey?.trim() || !selectedWorkflowId) {
        setExecutions([])
        setNextCursor(null)
        setHasMore(false)
        setHistoryError('')
        setLoadingHistory(false)
        setLoadingMore(false)
        return
      }

      if (append) {
        setLoadingMore(true)
      } else {
        setLoadingHistory(true)
        setHistoryError('')
        setDetails(null)
        setDetailsError('')
      }

      try {
        const result = await getWorkflowExecutions(
          selectedWorkflowId,
          tenantApiKey,
          {
            limit: PAGE_SIZE,
            ...(append && cursor ? { cursor } : {}),
          },
        )

        if (requestId !== historyRequestId.current) return

        setExecutions((current) => {
          if (!append) return result.executions

          const seen = new Set(
            current.map((item) => item.id ?? item._id),
          )

          return [
            ...current,
            ...result.executions.filter(
              (item) => !seen.has(item.id ?? item._id),
            ),
          ]
        })

        setNextCursor(result.pagination.nextCursor)
        setHasMore(result.pagination.hasMore)
      } catch {
        if (requestId !== historyRequestId.current) return

        setHistoryError(
          'Unable to load execution history. Check your connection and try again.',
        )
      } finally {
        if (requestId === historyRequestId.current) {
          setLoadingHistory(false)
          setLoadingMore(false)
        }
      }
    },
    [tenantApiKey, selectedWorkflowId],
  )

  useEffect(() => {
    void loadHistory(false)

    return () => {
      historyRequestId.current += 1
    }
  }, [loadHistory, refreshToken])

  useEffect(() => {
    if (!tenantApiKey?.trim() || !selectedWorkflowId) {
      return
    }

    return connectExecutionUpdates({
      apiKey: tenantApiKey,

      onEvent: (event) => {
        if (event.data.workflowId !== selectedWorkflowId) {
          return
        }

        setExecutions((current) =>
          current.map((execution) => {
            const id = execution.id ?? execution._id

            if (id !== event.data.executionId) {
              return execution
            }

            return {
              ...execution,
              status: event.data.status,
              updatedAt: event.data.updatedAt,
            }
          }),
        )

        setDetails((current) => {
          const id = current?.id ?? current?._id

          if (
            !current ||
            id !== event.data.executionId ||
            current.workflowId !== event.data.workflowId
          ) {
            return current
          }

          return {
            ...current,
            status: event.data.status,
            updatedAt: event.data.updatedAt,
          }
        })
      },

      onReconnect: () => {
        // REST remains the source of truth after missed WebSocket events.
        void loadHistory(false)
      },
    })
  }, [tenantApiKey, selectedWorkflowId, loadHistory])
  async function showDetails(execution: WorkflowExecution) {
    const requestId = ++detailsRequestId.current
    const id = execution.id ?? execution._id

    if (!id || !tenantApiKey?.trim()) {
      setDetailsError(
        'Execution details are unavailable because the record has no ID or API authentication is missing.',
      )
      return
    }

    setDetailsLoadingId(id)
    setDetailsError('')
    setDetails(null)

    try {
      const result = await getExecution(id, tenantApiKey)
      if (requestId !== detailsRequestId.current) return
      setDetails(result)
    } catch (error) {
      if (requestId !== detailsRequestId.current) return

      setDetailsError(
        getRequestError(error, 'Unable to load execution details.'),
      )
    } finally {
      if (requestId === detailsRequestId.current) {
        setDetailsLoadingId('')
      }
    }
  }

  return (
    <section className="executions-page">
      <header className="executions-page__header">
        <div>
          <p className="executions-page__eyebrow">
            WORKFLOW MONITORING
          </p>
          <h1>Executions</h1>
          <p>
            Inspect execution history returned by the backend.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setRefreshToken((value) => value + 1)}
          disabled={
            loadingHistory ||
            loadingMore ||
            loadingWorkflows ||
            !selectedWorkflowId
          }
        >
          Refresh history
        </button>
      </header>

      <div className="executions-page__selector">
        <label htmlFor="execution-workflow">
          Saved workflow
        </label>

        <select
          id="execution-workflow"
          value={selectedWorkflowId}
          onChange={(event) => {
            detailsRequestId.current += 1
            setDetailsLoadingId('')
            setSelectedWorkflowId(event.target.value)
            setExecutions([])
            setNextCursor(null)
            setHasMore(false)
            setDetails(null)
            setDetailsError('')
          }}
          disabled={loadingWorkflows || workflows.length === 0}
        >
          {workflows.length === 0 && (
            <option value="">No saved workflows</option>
          )}

          {workflows.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>
              {workflow.name}
            </option>
          ))}
        </select>
      </div>

      {loadingWorkflows && (
        <p role="status" aria-live="polite">
          Loading saved workflows…
        </p>
      )}

      {workflowError && (
        <p className="executions-page__error" role="alert">
          {workflowError}
        </p>
      )}

      {!loadingWorkflows &&
        !workflowError &&
        workflows.length === 0 && (
          <div className="executions-page__state">
            <h2>No saved workflows</h2>
            <p>
              Create and save a workflow before viewing its
              execution history.
            </p>
          </div>
        )}

      {selectedWorkflowId && (
        <section aria-labelledby="execution-history-heading" aria-busy={loadingHistory || loadingMore}>
          <div className="executions-page__section-heading">
            <h2 id="execution-history-heading">
              Execution history
            </h2>
            <span>{executions.length} loaded</span>
          </div>

          {loadingHistory && (
            <p role="status" aria-live="polite">
              Loading execution history...
            </p>
          )}

          {historyError && (
            <div className="executions-page__error-state" role="alert">
              <p>{historyError}</p>
              <button
                type="button"
                onClick={() => setRefreshToken((value) => value + 1)}
                disabled={loadingHistory || loadingMore}
              >
                Retry loading history
              </button>
            </div>
          )}

          {!loadingHistory &&
            !historyError &&
            executions.length === 0 && (
              <div className="executions-page__state">
                <h3>No executions yet</h3>
                <p>
                  The backend returned no execution records
                  for this workflow.
                </p>
              </div>
            )}

          {executions.length > 0 && (
            <div className="executions-page__list">
              {executions.map((execution, index) => {
                const id =
                  execution.id ??
                  execution._id ??
                  `${execution.workflowId}-${index}`

                const errorText = getErrorText(execution.error)

                return (
                  <article
                    className="executions-page__item"
                    key={id}
                  >
                    <div className="executions-page__item-top">
                      <div>
                        <h3>
                          Execution{' '}
                          {execution.id ??
                            execution._id ??
                            `#${index + 1}`}
                        </h3>

                        <p className="executions-page__muted">
                          Created:{' '}
                          {formatDate(
                            execution.createdAt ??
                              execution.startedAt,
                          )}
                        </p>
                      </div>

                      <span
                        className={`executions-page__status ${getStatusClass(
                          execution.status,
                        )}`}
                        role="status"
                        aria-label={`Execution status: ${getStatusLabel(
                          execution.status,
                        )}`}
                      >
                        {getStatusLabel(execution.status)}
                      </span>
                    </div>

                    <dl className="executions-page__metadata">
                      <div>
                        <dt>Started</dt>
                        <dd>{formatDate(execution.startedAt)}</dd>
                      </div>

                      <div>
                        <dt>Completed</dt>
                        <dd>{formatDate(execution.completedAt)}</dd>
                      </div>

                      <div>
                        <dt>Workflow version</dt>
                        <dd>
                          {execution.workflowVersion ??
                            'Not available'}
                        </dd>
                      </div>

                      <div>
                        <dt>Node results</dt>
                        <dd>
                          {execution.nodeResults?.length ?? 0}
                        </dd>
                      </div>
                    </dl>

                    {errorText && (
                      <p
                        className="executions-page__error"
                        role="status"
                      >
                        Error: {errorText}
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={() => void showDetails(execution)}
                      disabled={
                        detailsLoadingId ===
                        (execution.id ?? execution._id)
                      }
                    >
                      {detailsLoadingId ===
                      (execution.id ?? execution._id)
                        ? 'Loading detailsâ€¦'
                        : 'View details'}
                    </button>
                  </article>
                )
              })}
            </div>
          )}

          {hasMore && (
            <button
              className="executions-page__load-more"
              type="button"
              onClick={() => void loadHistory(true, nextCursor)}
              disabled={
                loadingMore ||
                loadingHistory ||
                !nextCursor
              }
            >
              {loadingMore ? 'Loading more executionsâ€¦' : 'Load more'}
            </button>
          )}
        </section>
      )}

      {detailsError && (
        <p className="executions-page__error" role="alert">
          {detailsError}
        </p>
      )}

      {details && (
        <section
          className="executions-page__details"
          aria-labelledby="execution-details-heading"
        >
          <div className="executions-page__section-heading">
            <h2 id="execution-details-heading">
              Execution details
            </h2>

            <button
              type="button"
              onClick={() => {
                detailsRequestId.current += 1
                setDetailsLoadingId('')
                setDetails(null)
                setDetailsError('')
              }}
            >
              Close details
            </button>
          </div>

          <p>
            <strong>Status:</strong>{' '}
            <span
              className={`executions-page__status ${getStatusClass(
                details.status,
              )}`}
            >
              {getStatusLabel(details.status)}
            </span>
          </p>

          <p>
            <strong>Workflow ID:</strong> {details.workflowId}
          </p>

          {details.currentNodeId && (
            <p>
              <strong>Current node:</strong>{' '}
              {details.currentNodeId}
            </p>
          )}

          {getErrorText(details.error) && (
            <p className="executions-page__error" role="status">
              Error: {getErrorText(details.error)}
            </p>
          )}

          <h3>Node results</h3>

          {!details.nodeResults?.length ? (
            <p>
              No node results were returned for this execution.
            </p>
          ) : (
            <ul className="executions-page__node-list">
              {details.nodeResults.map((node, index) => (
                <li key={`${node.nodeId}-${index}`}>
                  <strong>{node.nodeId}</strong>
                  <span>{node.status}</span>

                  {node.error && (
                    <p className="executions-page__error">
                      {sanitizeErrorMessage(
                        typeof node.error === 'string'
                          ? node.error
                          : node.error.message ?? '',
                      )}
                    </p>
                  )}

                  {node.compensation && (
                    <div className="executions-page__compensation">
                      <p>
                        <strong>Compensation status:</strong>{' '}
                        <span
                          className={`executions-page__status executions-page__status--${node.compensation.status}`}
                        >
                          {node.compensation.status}
                        </span>
                      </p>

                      {node.compensation.startedAt && (
                        <p>
                          <strong>Compensation started:</strong>{' '}
                          {formatDate(node.compensation.startedAt)}
                        </p>
                      )}

                      {node.compensation.completedAt && (
                        <p>
                          <strong>Compensation completed:</strong>{' '}
                          {formatDate(node.compensation.completedAt)}
                        </p>
                      )}

                      {node.compensation.error && (
                        <p className="executions-page__error">
                          Compensation error:{' '}
                          {sanitizeErrorMessage(
                            node.compensation.error.message ?? "Compensation failed.",
                          )}
                        </p>
                      )}
                    </div>
                  )}

                  {node.output !== undefined && (
                    <pre>
                      {JSON.stringify(node.output, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  )
}

export default ExecutionsPage