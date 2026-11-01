import { useCallback, useEffect, useState, useRef } from 'react'
import { getWorkflows, type CreatedWorkflow } from '../api/workflowApi'
import {
  getExecution,
  getWorkflowExecutions,
  getGlobalExecutions,
  getExecutionSummary,
  type WorkflowExecution,
  type WorkflowExecutionHistory,
  type ExecutionSummary,
} from '../api/executionApi'
import {
  connectExecutionUpdates,
  type RealtimeConnectionStatus,
} from '../api/executionRealtime'
import {
  getErrorText,
  sanitizeErrorMessage,
  isValidExecutionId,
  matchesExecutionFilters,
  applyRealtimeExecutionUpdate,
  insertIngestedExecution,
  formatPercentage,
  formatDuration,
  calculateCurrentlyRunning,
} from '../executionHelpers'
import './ExecutionsPage.css'

type SavedWorkflow = {
  id: string
  name: string
}

const PAGE_SIZE = 20

function getId(item: CreatedWorkflow): string {
  return String(item.id ?? item._id ?? '')
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
  const [statusFilter, setStatusFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [searchExecutionId, setSearchExecutionId] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [executions, setExecutions] = useState<WorkflowExecution[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const [loadingWorkflows, setLoadingWorkflows] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const [workflowError, setWorkflowError] = useState('')
  const [historyError, setHistoryError] = useState('')

  const [summary, setSummary] = useState<ExecutionSummary | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [summaryError, setSummaryError] = useState('')

  const [details, setDetails] = useState<WorkflowExecution | null>(null)
  const [detailsLoadingId, setDetailsLoadingId] = useState('')
  const [detailsError, setDetailsError] = useState('')
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [selectedExecutionId, setSelectedExecutionId] = useState('')
  const [wsStatus, setWsStatus] = useState<RealtimeConnectionStatus>('disconnected')

  const [refreshToken, setRefreshToken] = useState(0)
  const historyRequestId = useRef(0)
  const summaryRequestId = useRef(0)
  const detailsRequestId = useRef(0)
  const drawerRef = useRef<HTMLElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const triggerButtonRef = useRef<HTMLElement | null>(null)
  const inFlightIngestion = useRef(new Set<string>())
  const activeFiltersRef = useRef({
    selectedWorkflowId,
    statusFilter,
    fromDate,
    toDate,
    searchExecutionId: debouncedSearch,
  })

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchExecutionId.trim())
    }, 300)
    return () => clearTimeout(timer)
  }, [searchExecutionId])

  useEffect(() => {
    activeFiltersRef.current = {
      selectedWorkflowId,
      statusFilter,
      fromDate,
      toDate,
      searchExecutionId: debouncedSearch,
    }
  }, [selectedWorkflowId, statusFilter, fromDate, toDate, debouncedSearch])

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
          current && saved.some((item) => item.id === current)
            ? current
            : '',
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

      if (!tenantApiKey?.trim()) {
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

      if (debouncedSearch && !isValidExecutionId(debouncedSearch)) {
        setExecutions([])
        setNextCursor(null)
        setHasMore(false)
        setHistoryError('Please enter a valid 24-character hexadecimal execution ID.')
        setLoadingHistory(false)
        setLoadingMore(false)
        return
      }

      try {
        let result: WorkflowExecutionHistory

        const hasActiveFilters = Boolean(
          statusFilter || fromDate || toDate || debouncedSearch,
        )

        if (selectedWorkflowId && !hasActiveFilters) {
          result = await getWorkflowExecutions(
            selectedWorkflowId,
            tenantApiKey,
            {
              limit: PAGE_SIZE,
              ...(append && cursor ? { cursor } : {}),
            },
          )
        } else {
          result = await getGlobalExecutions(tenantApiKey, {
            workflowId: selectedWorkflowId || undefined,
            limit: PAGE_SIZE,
            status: statusFilter || undefined,
            from: fromDate ? new Date(fromDate).toISOString() : undefined,
            to: toDate ? new Date(toDate + 'T23:59:59.999Z').toISOString() : undefined,
            executionId: debouncedSearch || undefined,
            ...(append && cursor ? { cursor } : {}),
          })
        }

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

        setNextCursor(result.pagination?.nextCursor ?? null)
        setHasMore(Boolean(result.pagination?.hasMore))
      } catch (error) {
        if (requestId !== historyRequestId.current) return

        setHistoryError(
          getRequestError(
            error,
            'Unable to load execution history. Check your connection and try again.',
          ),
        )
      } finally {
        if (requestId === historyRequestId.current) {
          setLoadingHistory(false)
          setLoadingMore(false)
        }
      }
    },
    [tenantApiKey, selectedWorkflowId, statusFilter, fromDate, toDate, debouncedSearch],
  )

  const loadHistoryRef = useRef(loadHistory)

  useEffect(() => {
    loadHistoryRef.current = loadHistory
  }, [loadHistory])

  const loadSummary = useCallback(
    async (workflowId?: string, from?: string, to?: string) => {
      const requestId = ++summaryRequestId.current

      if (!tenantApiKey?.trim()) {
        setSummary(null)
        setSummaryError('')
        setLoadingSummary(false)
        return
      }

      setLoadingSummary(true)
      setSummaryError('')

      try {
        const fromIso = from ? new Date(from).toISOString() : undefined
        const toIso = to
          ? new Date(to.includes('T') ? to : to + 'T23:59:59.999Z').toISOString()
          : undefined

        const result = await getExecutionSummary(tenantApiKey, {
          workflowId: workflowId || undefined,
          from: fromIso,
          to: toIso,
        })

        if (requestId !== summaryRequestId.current) return

        setSummary(result.summary)
      } catch (error) {
        if (requestId !== summaryRequestId.current) return

        setSummaryError(
          getRequestError(error, 'Unable to load execution summary metrics.'),
        )
      } finally {
        if (requestId === summaryRequestId.current) {
          setLoadingSummary(false)
        }
      }
    },
    [tenantApiKey],
  )

  const loadSummaryRef = useRef(loadSummary)

  useEffect(() => {
    loadSummaryRef.current = loadSummary
  }, [loadSummary])

  useEffect(() => {
    let active = true
    async function triggerLoadSummary() {
      if (!active) return
      await loadSummary(selectedWorkflowId, fromDate, toDate)
    }
    void triggerLoadSummary()

    return () => {
      active = false
      summaryRequestId.current += 1
    }
  }, [loadSummary, selectedWorkflowId, fromDate, toDate, refreshToken])

  useEffect(() => {
    let active = true
    async function initLoad() {
      if (!active) return
      await loadHistory(false)
    }
    void initLoad()

    return () => {
      active = false
      historyRequestId.current += 1
    }
  }, [loadHistory, refreshToken])

  useEffect(() => {
    let isMounted = true

    if (!tenantApiKey?.trim()) {
      setWsStatus('disconnected')
      return
    }

    const cleanup = connectExecutionUpdates({
      apiKey: tenantApiKey,
      onStatusChange: (status) => {
        if (isMounted) {
          setWsStatus(status)
        }
      },

      onEvent: async (event) => {
        if (!isMounted) return

        const currentFilters = activeFiltersRef.current

        // In specific workflow mode, retain workflow filtering
        if (
          currentFilters.selectedWorkflowId &&
          event.data.workflowId !== currentFilters.selectedWorkflowId
        ) {
          return
        }

        const eventExecutionId = event.data.executionId
        let exists = false

        setExecutions((current) => {
          const { updatedList, wasFound } = applyRealtimeExecutionUpdate(
            current,
            event,
          )
          exists = wasFound
          return updatedList
        })

        setDetails((current) => {
          const id = current?.id ?? current?._id

          if (!current || id !== eventExecutionId) {
            return current
          }

          return {
            ...current,
            status: event.data.status,
            updatedAt: event.data.updatedAt,
          }
        })

        // Unseen execution: fetch authoritative record via REST
        if (!exists) {
          if (
            currentFilters.statusFilter &&
            event.data.status !== currentFilters.statusFilter
          ) {
            return
          }

          if (inFlightIngestion.current.has(eventExecutionId)) {
            return
          }

          inFlightIngestion.current.add(eventExecutionId)

          try {
            const record = await getExecution(eventExecutionId, tenantApiKey)
            if (!isMounted) return

            const latestFilters = activeFiltersRef.current
            if (!matchesExecutionFilters(record, latestFilters)) {
              return
            }

            setExecutions((current) => insertIngestedExecution(current, record))
          } catch {
            // Ingestion is best effort; REST reconciliation covers misses
          } finally {
            inFlightIngestion.current.delete(eventExecutionId)
          }
        }
      },

      onReconnect: () => {
        // REST remains the source of truth after missed WebSocket events.
        void loadHistoryRef.current(false)
        void loadSummaryRef.current(
          activeFiltersRef.current.selectedWorkflowId,
          activeFiltersRef.current.fromDate,
          activeFiltersRef.current.toDate,
        )
      },
    })

    return () => {
      isMounted = false
      setWsStatus('disconnected')
      cleanup()
    }
  }, [tenantApiKey])

  function closeDrawer() {
    detailsRequestId.current += 1
    setIsDrawerOpen(false)
    setSelectedExecutionId('')
    setDetails(null)
    setDetailsLoadingId('')
    setDetailsError('')
    triggerButtonRef.current?.focus()
  }

  useEffect(() => {
    if (!isDrawerOpen) return

    closeButtonRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeDrawer()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isDrawerOpen])

  async function showDetails(execution: WorkflowExecution, triggerElement?: HTMLElement) {
    if (triggerElement) {
      triggerButtonRef.current = triggerElement
    }
    const requestId = ++detailsRequestId.current
    const id = execution.id ?? execution._id

    setIsDrawerOpen(true)
    setSelectedExecutionId(id || '')

    if (!id || !tenantApiKey?.trim()) {
      setDetailsError(
        'Execution details are unavailable because the record has no ID or API authentication is missing.',
      )
      setDetailsLoadingId('')
      setDetails(null)
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
            Monitor and investigate workflow activity.
          </p>
        </div>

        <div className="executions-page__header-actions">
          <div
            className={`executions-page__ws-indicator executions-page__ws-indicator--${wsStatus}`}
            role="status"
            aria-live="polite"
            aria-label={`Realtime connection: ${wsStatus}`}
            title={
              wsStatus === 'connected'
                ? 'Realtime updates connected'
                : wsStatus === 'connecting'
                  ? 'Connecting to realtime updates…'
                  : 'Realtime updates disconnected'
            }
          >
            <span className="executions-page__ws-dot" aria-hidden="true" />
            <span className="executions-page__ws-label">
              {wsStatus === 'connected'
                ? 'Live updates'
                : wsStatus === 'connecting'
                  ? 'Connecting…'
                  : 'Offline'}
            </span>
          </div>

          <button
            type="button"
            className="executions-page__refresh-btn"
            onClick={() => setRefreshToken((value) => value + 1)}
            disabled={
              loadingHistory ||
              loadingMore ||
              loadingWorkflows ||
              loadingSummary
            }
          >
            ↻ Refresh history
          </button>
        </div>
      </header>

      {summaryError && (
        <div className="executions-page__error" role="alert">
          {summaryError}
        </div>
      )}

      {/* Metric Cards Structure */}
      <section
        className="executions-page__stats"
        aria-label="Execution Metrics"
        aria-busy={loadingSummary}
      >
        <article className="execution-stat-card execution-stat-card--total">
          <div className="execution-stat-card__header">
            <span className="execution-stat-card__label">Total Executions</span>
            <span className="execution-stat-card__icon" aria-hidden="true">⚡</span>
          </div>
          <div className={`execution-stat-card__value ${summary ? '' : 'execution-stat-card__value--unavailable'}`}>
            {summary ? summary.total : '—'}
          </div>
          <p className="execution-stat-card__detail">
            {summary
              ? `Avg duration: ${formatDuration(summary.avgDurationMs)}`
              : loadingSummary
                ? 'Loading metrics…'
                : summaryError
                  ? 'Metrics unavailable'
                  : 'Aggregate metrics unavailable'}
          </p>
        </article>

        <article className="execution-stat-card execution-stat-card--completed">
          <div className="execution-stat-card__header">
            <span className="execution-stat-card__label">Completed</span>
            <span className="execution-stat-card__badge execution-stat-card__badge--completed">Completed</span>
          </div>
          <div className={`execution-stat-card__value ${summary ? '' : 'execution-stat-card__value--unavailable'}`}>
            {summary ? summary.completed : '—'}
          </div>
          <p className="execution-stat-card__detail">
            {summary
              ? `Success rate: ${formatPercentage(summary.successRate)}`
              : loadingSummary
                ? 'Loading metrics…'
                : summaryError
                  ? 'Metrics unavailable'
                  : 'Aggregate metrics unavailable'}
          </p>
        </article>

        <article className="execution-stat-card execution-stat-card--failed">
          <div className="execution-stat-card__header">
            <span className="execution-stat-card__label">Failed</span>
            <span className="execution-stat-card__badge execution-stat-card__badge--failed">Failed</span>
          </div>
          <div className={`execution-stat-card__value ${summary ? '' : 'execution-stat-card__value--unavailable'}`}>
            {summary ? summary.failed : '—'}
          </div>
          <p className="execution-stat-card__detail">
            {summary
              ? `Failure rate: ${formatPercentage(summary.failureRate)}`
              : loadingSummary
                ? 'Loading metrics…'
                : summaryError
                  ? 'Metrics unavailable'
                  : 'Aggregate metrics unavailable'}
          </p>
        </article>

        <article className="execution-stat-card execution-stat-card--running">
          <div className="execution-stat-card__header">
            <span className="execution-stat-card__label">Currently Running</span>
            <span className="execution-stat-card__badge execution-stat-card__badge--running">Running</span>
          </div>
          <div className={`execution-stat-card__value ${summary ? '' : 'execution-stat-card__value--unavailable'}`}>
            {summary ? calculateCurrentlyRunning(summary) : '—'}
          </div>
          <p className="execution-stat-card__detail">
            {summary
              ? summary.compensating > 0
                ? `${summary.running} running, ${summary.compensating} compensating`
                : summary.queued > 0
                  ? `${summary.queued} queued`
                  : 'Active workflow runs'
              : loadingSummary
                ? 'Loading metrics…'
                : summaryError
                  ? 'Metrics unavailable'
                  : 'Aggregate metrics unavailable'}
          </p>
        </article>
      </section>

      <div className="executions-page__filters" role="search" aria-label="Execution filters">
        <div className="executions-page__filter-group executions-page__filter-group--workflow">
          <label htmlFor="execution-workflow">
            Workflow
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
            disabled={loadingWorkflows}
          >
            <option value="">All workflows</option>
            {workflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}
              </option>
            ))}
          </select>
        </div>

        <div className="executions-page__filter-group">
          <label htmlFor="execution-status">
            Status
          </label>
          <select
            id="execution-status"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value)
              setExecutions([])
              setNextCursor(null)
              setHasMore(false)
            }}
            disabled={loadingWorkflows}
          >
            <option value="">All statuses</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="compensating">Compensating</option>
            <option value="compensated">Compensated</option>
            <option value="compensation_failed">Compensation failed</option>
          </select>
        </div>

        <div className="executions-page__filter-group">
          <label htmlFor="execution-from">
            From date
          </label>
          <input
            id="execution-from"
            type="date"
            value={fromDate}
            onChange={(event) => {
              setFromDate(event.target.value)
              setExecutions([])
              setNextCursor(null)
              setHasMore(false)
            }}
            disabled={loadingWorkflows}
          />
        </div>

        <div className="executions-page__filter-group">
          <label htmlFor="execution-to">
            To date
          </label>
          <input
            id="execution-to"
            type="date"
            value={toDate}
            onChange={(event) => {
              setToDate(event.target.value)
              setExecutions([])
              setNextCursor(null)
              setHasMore(false)
            }}
            disabled={loadingWorkflows}
          />
        </div>

        <div className="executions-page__filter-group executions-page__filter-group--search">
          <label htmlFor="execution-search">
            Execution ID
          </label>
          <div className="executions-page__search-wrapper">
            <input
              id="execution-search"
              type="search"
              placeholder="Search 24-character ID…"
              value={searchExecutionId}
              onChange={(event) => {
                setSearchExecutionId(event.target.value)
                setExecutions([])
                setNextCursor(null)
                setHasMore(false)
              }}
              disabled={loadingWorkflows}
              autoComplete="off"
              spellCheck="false"
            />
            {searchExecutionId && (
              <button
                type="button"
                className="executions-page__search-clear-btn"
                onClick={() => {
                  setSearchExecutionId('')
                  setDebouncedSearch('')
                  setExecutions([])
                  setNextCursor(null)
                  setHasMore(false)
                }}
                aria-label="Clear execution ID search"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {(selectedWorkflowId || statusFilter || fromDate || toDate || searchExecutionId) && (
          <div className="executions-page__filter-actions">
            <button
              type="button"
              className="executions-page__clear-btn"
              onClick={() => {
                setSelectedWorkflowId('')
                setStatusFilter('')
                setFromDate('')
                setToDate('')
                setSearchExecutionId('')
                setDebouncedSearch('')
                setExecutions([])
                setNextCursor(null)
                setHasMore(false)
              }}
            >
              Clear filters
            </button>
          </div>
        )}
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

      <section aria-labelledby="execution-history-heading" aria-busy={loadingHistory || loadingMore}>
        <div className="executions-page__section-heading">
          <h2 id="execution-history-heading">
            {selectedWorkflowId
              ? (workflows.find((w) => w.id === selectedWorkflowId)?.name ?? 'Workflow') + ' executions'
              : 'Global execution history'}
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
              <h3>No executions found</h3>
              <p>
                {selectedWorkflowId
                  ? 'The backend returned no execution records for this workflow.'
                  : 'The backend returned no execution records matching your criteria.'}
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
                      {!selectedWorkflowId && (
                        <div>
                          <dt>Workflow</dt>
                          <dd>
                            {workflows.find(
                              (w) => w.id === String(execution.workflowId),
                            )?.name ?? String(execution.workflowId)}
                          </dd>
                        </div>
                      )}

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
                      onClick={(e) => void showDetails(execution, e.currentTarget)}
                      disabled={
                        detailsLoadingId ===
                        (execution.id ?? execution._id)
                      }
                    >
                      {detailsLoadingId ===
                      (execution.id ?? execution._id)
                        ? 'Loading details…'
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
              {loadingMore ? 'Loading more executions…' : 'Load more'}
            </button>
          )}
        </section>

      {isDrawerOpen && (
        <aside
          className="executions-page__drawer"
          role="dialog"
          aria-modal="false"
          aria-labelledby="execution-details-heading"
          ref={drawerRef}
          tabIndex={-1}
        >
          <div className="executions-page__drawer-header">
            <div>
              <h2 id="execution-details-heading">
                Execution details
              </h2>
              {selectedExecutionId && (
                <span className="executions-page__drawer-id">
                  ID: {selectedExecutionId}
                </span>
              )}
            </div>

            <button
              type="button"
              className="executions-page__drawer-close"
              onClick={closeDrawer}
              aria-label="Close execution details"
              ref={closeButtonRef}
            >
              Close details
            </button>
          </div>

          <div className="executions-page__drawer-body">
            {detailsLoadingId && !details && (
              <div className="executions-page__drawer-loading" role="status">
                <p>Loading execution details…</p>
              </div>
            )}

            {detailsError && (
              <p className="executions-page__error" role="alert">
                {detailsError}
              </p>
            )}

            {details && (
              <>
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

                {details.compensation && (
                  <div className="executions-page__execution-compensation">
                    <h3>Saga compensation</h3>
                    <p>
                      <strong>Compensation status:</strong>{' '}
                      <span
                        className={`executions-page__status executions-page__status--${details.compensation.status}`}
                      >
                        {details.compensation.status}
                      </span>
                    </p>

                    {details.compensation.startedAt && (
                      <p>
                        <strong>Compensation started:</strong>{' '}
                        {formatDate(details.compensation.startedAt)}
                      </p>
                    )}

                    {details.compensation.completedAt && (
                      <p>
                        <strong>Compensation completed:</strong>{' '}
                        {formatDate(details.compensation.completedAt)}
                      </p>
                    )}

                    {Boolean(details.compensation.error) && (
                      <p className="executions-page__error">
                        Compensation error:{' '}
                        {sanitizeErrorMessage(
                          typeof details.compensation.error === 'string'
                            ? details.compensation.error
                            : typeof details.compensation.error === 'object' &&
                              details.compensation.error !== null &&
                              'message' in details.compensation.error
                              ? String(
                                  (details.compensation.error as { message?: unknown }).message ?? '',
                                )
                              : 'Compensation failed.',
                        )}
                      </p>
                    )}
                  </div>
                )}

                <h3>Node results</h3>

                {!details.nodeResults?.length ? (
                  <p className="executions-page__empty-node-results">
                    No node results were returned for this execution.
                  </p>
                ) : (
                  <ul className="executions-page__node-list">
                    {details.nodeResults.map((node, index) => (
                      <li key={`${node.nodeId}-${index}`}>
                        <strong>{node.nodeId}</strong>
                        <span>{node.status}</span>

                        {node.error && getErrorText(node.error) && (
                          <p className="executions-page__error">
                            Error: {getErrorText(node.error)}
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

                            {Boolean(node.compensation.error) && (
                              <p className="executions-page__error">
                                Compensation error:{' '}
                                {sanitizeErrorMessage(
                                  typeof node.compensation.error === 'string'
                                    ? node.compensation.error
                                    : typeof node.compensation.error === 'object' &&
                                      node.compensation.error !== null &&
                                      'message' in node.compensation.error
                                      ? String(
                                          (node.compensation.error as { message?: unknown }).message ?? '',
                                        )
                                      : 'Compensation failed.',
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
              </>
            )}
          </div>
        </aside>
      )}
    </section>
  )
}

export default ExecutionsPage