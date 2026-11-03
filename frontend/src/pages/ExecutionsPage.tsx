import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
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
  buildExecutionTimeline,
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

function formatDate(value?: string | null): string {
  if (!value) return 'Not available'

  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? 'Invalid timestamp'
    : date.toLocaleString()
}

function getExecutionDuration(execution: WorkflowExecution): string {
  if (!execution.startedAt || !execution.completedAt) return '—'
  const start = new Date(execution.startedAt).getTime()
  const end = new Date(execution.completedAt).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—'
  return formatDuration(end - start)
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
  initialExecutionId,
  onInitialExecutionHandled,
}: {
  tenantApiKey?: string
  initialExecutionId?: string | null
  onInitialExecutionHandled?: () => void
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
  const [loadingHistory, setLoadingHistory] = useState(() =>
    Boolean(tenantApiKey?.trim()),
  )
  const [loadingMore, setLoadingMore] = useState(false)

  const [workflowError, setWorkflowError] = useState('')
  const [historyError, setHistoryError] = useState('')

  const [summary, setSummary] = useState<ExecutionSummary | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [summaryError, setSummaryError] = useState('')

  const [details, setDetails] = useState<WorkflowExecution | null>(null)
  const timeline = useMemo(() => buildExecutionTimeline(details), [details])
  const [detailsLoadingId, setDetailsLoadingId] = useState('')
  const [detailsError, setDetailsError] = useState('')
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [selectedExecutionId, setSelectedExecutionId] = useState('')
  const [copiedId, setCopiedId] = useState(false)
  const [wsStatus, setWsStatus] = useState<RealtimeConnectionStatus>(() =>
    tenantApiKey?.trim() ? 'connecting' : 'disconnected',
  )

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

  // Load workflow names for filter dropdown and table resolution
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

  // Load execution history with pagination
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

  // Load summary metrics from backend
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

  // Summary reload effect
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

  // History reload effect
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

  // Realtime WebSocket connection
  useEffect(() => {
    let isMounted = true

    if (!tenantApiKey?.trim()) {
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
            // Ingestion is best effort; REST reconciliation handles drops
          } finally {
            inFlightIngestion.current.delete(eventExecutionId)
          }
        }
      },

      onReconnect: () => {
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
      cleanup()
    }
  }, [tenantApiKey])

  // Detail drawer controls
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

  const loadDetails = useCallback(
    async (id: string, triggerElement?: HTMLElement) => {
      if (triggerElement) {
        triggerButtonRef.current = triggerElement
      }
      const requestId = ++detailsRequestId.current

      setIsDrawerOpen(true)
      setSelectedExecutionId(id)

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
    },
    [tenantApiKey],
  )

  function showDetails(execution: WorkflowExecution, triggerElement?: HTMLElement) {
    const id = execution.id ?? execution._id ?? ''
    void loadDetails(id, triggerElement)
  }

  useEffect(() => {
    if (!initialExecutionId) return
    const idToLoad = initialExecutionId
    onInitialExecutionHandled?.()
    queueMicrotask(() => {
      void loadDetails(idToLoad)
    })
  }, [initialExecutionId, loadDetails, onInitialExecutionHandled])

  const hasActiveFilters = Boolean(
    selectedWorkflowId || statusFilter || fromDate || toDate || searchExecutionId,
  )

  function clearAllFilters() {
    setSelectedWorkflowId('')
    setStatusFilter('')
    setFromDate('')
    setToDate('')
    setSearchExecutionId('')
    setDebouncedSearch('')
    setExecutions([])
    setNextCursor(null)
    setHasMore(false)
  }

  function handleCopyId(id: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(id)
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 1500)
    }
  }

  return (
    <section className="executions-page">
      {/* 1. Breadcrumb navigation */}
      <nav className="executions-page__breadcrumb" aria-label="Breadcrumb">
        <span className="executions-page__breadcrumb-item">Observability</span>
        <span className="executions-page__breadcrumb-separator" aria-hidden="true">/</span>
        <span className="executions-page__breadcrumb-item executions-page__breadcrumb-item--active" aria-current="page">
          Execution History
        </span>
      </nav>

      {/* 2. Header */}
      <header className="executions-page__header">
        <div className="executions-page__header-text">
          <p className="executions-page__eyebrow">ENTERPRISE OBSERVABILITY</p>
          <h1 className="executions-page__title">Execution History</h1>
          <p className="executions-page__subtitle">
            Monitor, filter, and inspect tenant-wide workflow execution runs and node timelines.
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
            aria-label="Refresh execution history"
          >
            <span aria-hidden="true">↻</span> Refresh history
          </button>
        </div>
      </header>

      {summaryError && (
        <div className="executions-page__error" role="alert">
          {summaryError}
        </div>
      )}

      {/* 3. Summary Metric Cards */}
      <section
        className="executions-page__stats"
        aria-label="Execution Metrics"
        aria-busy={loadingSummary}
      >
        <button
          type="button"
          className={`execution-stat-card execution-stat-card--total ${
            statusFilter === '' ? 'execution-stat-card--selected' : ''
          }`}
          onClick={() => {
            if (statusFilter !== '') {
              setStatusFilter('')
              setExecutions([])
              setNextCursor(null)
              setHasMore(false)
            }
          }}
          aria-label={`Total executions: ${summary?.total ?? 0}. Click to show all.`}
        >
          <div className="execution-stat-card__header">
            <span className="execution-stat-card__label">Total Executions</span>
            <span className="execution-stat-card__dot execution-stat-card__dot--total" />
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
        </button>

        <button
          type="button"
          className={`execution-stat-card execution-stat-card--completed ${
            statusFilter === 'completed' ? 'execution-stat-card--selected' : ''
          }`}
          onClick={() => {
            setStatusFilter(statusFilter === 'completed' ? '' : 'completed')
            setExecutions([])
            setNextCursor(null)
            setHasMore(false)
          }}
          aria-label={`Completed executions: ${summary?.completed ?? 0}. Click to filter.`}
        >
          <div className="execution-stat-card__header">
            <span className="execution-stat-card__label">Completed</span>
            <span className="execution-stat-card__dot execution-stat-card__dot--completed" />
          </div>
          <div className={`execution-stat-card__value execution-stat-card__value--completed ${summary ? '' : 'execution-stat-card__value--unavailable'}`}>
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
        </button>

        <button
          type="button"
          className={`execution-stat-card execution-stat-card--failed ${
            statusFilter === 'failed' ? 'execution-stat-card--selected' : ''
          }`}
          onClick={() => {
            setStatusFilter(statusFilter === 'failed' ? '' : 'failed')
            setExecutions([])
            setNextCursor(null)
            setHasMore(false)
          }}
          aria-label={`Failed executions: ${summary?.failed ?? 0}. Click to filter.`}
        >
          <div className="execution-stat-card__header">
            <span className="execution-stat-card__label">Failed</span>
            <span className="execution-stat-card__dot execution-stat-card__dot--failed" />
          </div>
          <div className={`execution-stat-card__value execution-stat-card__value--failed ${summary ? '' : 'execution-stat-card__value--unavailable'}`}>
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
        </button>

        <button
          type="button"
          className={`execution-stat-card execution-stat-card--running ${
            statusFilter === 'running' ? 'execution-stat-card--selected' : ''
          }`}
          onClick={() => {
            setStatusFilter(statusFilter === 'running' ? '' : 'running')
            setExecutions([])
            setNextCursor(null)
            setHasMore(false)
          }}
          aria-label={`Currently running executions: ${summary ? calculateCurrentlyRunning(summary) : 0}. Click to filter.`}
        >
          <div className="execution-stat-card__header">
            <span className="execution-stat-card__label">Currently Running</span>
            <span className="execution-stat-card__dot execution-stat-card__dot--running" />
          </div>
          <div className={`execution-stat-card__value execution-stat-card__value--running ${summary ? '' : 'execution-stat-card__value--unavailable'}`}>
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
        </button>
      </section>

      {/* 4. Filters Toolbar */}
      <div className="executions-page__filters" role="search" aria-label="Execution filters">
        <div className="executions-page__filter-group executions-page__filter-group--workflow">
          <label htmlFor="execution-workflow" className="executions-page__filter-label">
            Workflow:
          </label>
          <select
            id="execution-workflow"
            className="executions-page__select"
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
          <label htmlFor="execution-status" className="executions-page__filter-label">
            Status:
          </label>
          <select
            id="execution-status"
            className="executions-page__select"
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
          <label htmlFor="execution-from" className="executions-page__filter-label">
            From:
          </label>
          <input
            id="execution-from"
            type="date"
            className="executions-page__date-input"
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
          <label htmlFor="execution-to" className="executions-page__filter-label">
            To:
          </label>
          <input
            id="execution-to"
            type="date"
            className="executions-page__date-input"
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
          <label htmlFor="execution-search" className="executions-page__filter-label">
            Execution ID
          </label>
          <div className="executions-page__search-wrapper">
            <span className="executions-page__search-icon" aria-hidden="true">🔍</span>
            <input
              id="execution-search"
              type="search"
              className="executions-page__search-input"
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

        {hasActiveFilters && (
          <div className="executions-page__filter-actions">
            <button
              type="button"
              className="executions-page__clear-btn"
              onClick={clearAllFilters}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {loadingWorkflows && (
        <p className="executions-page__info-note" role="status" aria-live="polite">
          Loading saved workflows…
        </p>
      )}

      {workflowError && (
        <p className="executions-page__error" role="alert">
          {workflowError}
        </p>
      )}

      {/* 5. Execution Table Section */}
      <section aria-labelledby="execution-history-heading" aria-busy={loadingHistory || loadingMore}>
        <div className="executions-page__section-heading">
          <div>
            <h2 id="execution-history-heading" className="executions-page__section-title">
              {selectedWorkflowId
                ? (workflows.find((w) => w.id === selectedWorkflowId)?.name ?? 'Workflow') + ' executions'
                : 'Execution Records'}
            </h2>
          </div>
          <span className="executions-page__count-badge">
            {executions.length} loaded
          </span>
        </div>

        {loadingHistory && (
          <div className="executions-skeleton-table" role="status" aria-live="polite">
            <div className="executions-skeleton-row executions-skeleton-row--header" />
            <div className="executions-skeleton-row" />
            <div className="executions-skeleton-row" />
            <div className="executions-skeleton-row" />
            <span className="executions-visually-hidden">Loading execution history...</span>
          </div>
        )}

        {historyError && (
          <div className="executions-page__error-state" role="alert">
            <p>{historyError}</p>
            <button
              type="button"
              className="executions-page__retry-btn"
              onClick={() => setRefreshToken((value) => value + 1)}
              disabled={loadingHistory || loadingMore}
            >
              Retry loading history
            </button>
          </div>
        )}

        {!loadingHistory && !historyError && executions.length === 0 && (
          <div className="executions-empty-state" role="status">
            <div className="executions-empty-state__icon" aria-hidden="true">
              {hasActiveFilters ? '🔍' : '⚡'}
            </div>
            <h3>{hasActiveFilters ? 'No matching executions' : 'No executions found'}</h3>
            <p>
              {hasActiveFilters
                ? 'No execution records match your active search or filter criteria.'
                : selectedWorkflowId
                  ? 'The backend returned no execution records for this workflow.'
                  : 'The backend returned no execution records for this tenant.'}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                className="executions-page__clear-btn"
                onClick={clearAllFilters}
              >
                Clear all filters
              </button>
            )}
          </div>
        )}

        {!loadingHistory && executions.length > 0 && (
          <div className="executions-table-container">
            <table className="executions-table" role="table" aria-label="Execution history records">
              <thead>
                <tr>
                  <th scope="col" className="executions-table__th--id">Execution ID</th>
                  <th scope="col" className="executions-table__th--workflow">Workflow</th>
                  <th scope="col" className="executions-table__th--status">Status</th>
                  <th scope="col" className="executions-table__th--started">Started</th>
                  <th scope="col" className="executions-table__th--duration">Duration</th>
                  <th scope="col" className="executions-table__th--actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((execution, index) => {
                  const id = String(
                    execution.id ??
                      execution._id ??
                      `${execution.workflowId}-${index}`,
                  )
                  const wfName =
                    workflows.find((w) => w.id === String(execution.workflowId))?.name ??
                    `Workflow ${execution.workflowId}`
                  const errorText = getErrorText(execution.error)
                  const isSelected = selectedExecutionId === id
                  const isLoadingThis = detailsLoadingId === id

                  return (
                    <tr
                      key={id}
                      className={`executions-table__row ${isSelected ? 'executions-table__row--selected' : ''}`}
                      onClick={(e) => {
                        // Prevent triggering if clicked directly on an action button
                        if ((e.target as HTMLElement).tagName !== 'BUTTON') {
                          showDetails(execution)
                        }
                      }}
                    >
                      {/* Execution ID */}
                      <td className="executions-table__td--id">
                        <div className="execution-id-cell">
                          <code className="execution-id-cell__code" title={id}>
                            {id.slice(0, 8)}…{id.slice(-6)}
                          </code>
                          <button
                            type="button"
                            className="execution-id-cell__copy"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleCopyId(id)
                            }}
                            title="Copy full execution ID"
                            aria-label={`Copy execution ID ${id}`}
                          >
                            📋
                          </button>
                        </div>
                      </td>

                      {/* Workflow */}
                      <td className="executions-table__td--workflow">
                        <div className="execution-wf-cell">
                          <strong className="execution-wf-cell__name" title={wfName}>
                            {wfName}
                          </strong>
                          {execution.workflowVersion && (
                            <span className="execution-version-pill">
                              v{execution.workflowVersion}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="executions-table__td--status">
                        <span
                          className={`execution-status-pill execution-status-pill--${execution.status}`}
                          role="status"
                        >
                          <span className="execution-status-pill__dot" aria-hidden="true" />
                          {getStatusLabel(execution.status)}
                        </span>
                      </td>

                      {/* Started Time */}
                      <td className="executions-table__td--started">
                        <span className="executions-table__timestamp">
                          {formatDate(execution.startedAt ?? execution.createdAt)}
                        </span>
                      </td>

                      {/* Duration */}
                      <td className="executions-table__td--duration">
                        <span className="executions-table__duration-text">
                          {getExecutionDuration(execution)}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="executions-table__td--actions">
                        <div className="executions-table__action-wrap">
                          <button
                            type="button"
                            className="executions-row-action-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              showDetails(execution, e.currentTarget)
                            }}
                            disabled={isLoadingThis}
                            aria-label={`View details for execution ${id}`}
                          >
                            {isLoadingThis ? 'Loading…' : 'View details'}
                          </button>
                        </div>
                        {errorText && (
                          <span
                            className="executions-table__error-indicator"
                            title={`Error: ${errorText}`}
                            aria-hidden="true"
                          >
                            ⚠
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {hasMore && (
          <div className="executions-page__load-more-wrap">
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
              {loadingMore ? 'Loading more executions…' : 'Load more executions'}
            </button>
          </div>
        )}
      </section>

      {/* 6. Execution Details Drawer */}
      {isDrawerOpen && (
        <div
          className="executions-drawer-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDrawer()
          }}
        >
          <aside
            className="executions-page__drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="execution-details-heading"
            ref={drawerRef}
            tabIndex={-1}
          >
            {/* Drawer Top Navigation Bar */}
            <div className="executions-page__drawer-nav">
              <button
                type="button"
                className="executions-drawer-back-btn"
                onClick={closeDrawer}
              >
                ← Back to history
              </button>

              <button
                type="button"
                className="executions-page__drawer-close"
                onClick={closeDrawer}
                aria-label="Close execution details"
                ref={closeButtonRef}
              >
                ✕ Close
              </button>
            </div>

            <div className="executions-page__drawer-header">
              <div>
                <h2 id="execution-details-heading">
                  Execution Details
                </h2>
                {selectedExecutionId && (
                  <div className="executions-drawer-id-row">
                    <code className="executions-page__drawer-id">
                      {selectedExecutionId}
                    </code>
                    <button
                      type="button"
                      className="execution-id-cell__copy"
                      onClick={() => handleCopyId(selectedExecutionId)}
                      title="Copy execution ID"
                    >
                      {copiedId ? '✓ Copied' : '📋 Copy'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="executions-page__drawer-body">
              {detailsLoadingId && !details && (
                <div className="executions-page__drawer-loading" role="status">
                  <div className="executions-page__spinner" aria-hidden="true" />
                  <p>Loading execution details…</p>
                </div>
              )}

              {detailsError && (
                <div className="executions-page__error-state" role="alert">
                  <p>{detailsError}</p>
                  <button
                    type="button"
                    className="executions-page__retry-btn"
                    onClick={() => {
                      if (selectedExecutionId) void loadDetails(selectedExecutionId)
                    }}
                  >
                    Retry loading details
                  </button>
                </div>
              )}

              {details && (
                <>
                  {/* Execution Overview Panel */}
                  <div className="executions-drawer-overview-panel">
                    <div className="executions-drawer-overview-grid">
                      <div className="executions-drawer-overview-item">
                        <span className="executions-drawer-label">Status</span>
                        <span
                          className={`execution-status-pill execution-status-pill--${details.status}`}
                        >
                          <span className="execution-status-pill__dot" aria-hidden="true" />
                          {getStatusLabel(details.status)}
                        </span>
                      </div>

                      <div className="executions-drawer-overview-item">
                        <span className="executions-drawer-label">Workflow</span>
                        <span className="executions-drawer-value">
                          {workflows.find((w) => w.id === String(details.workflowId))?.name ??
                            String(details.workflowId)}
                          {details.workflowVersion && (
                            <span className="execution-version-pill">
                              v{details.workflowVersion}
                            </span>
                          )}
                        </span>
                      </div>

                      <div className="executions-drawer-overview-item">
                        <span className="executions-drawer-label">Started</span>
                        <span className="executions-drawer-value">
                          {formatDate(details.startedAt ?? details.createdAt)}
                        </span>
                      </div>

                      <div className="executions-drawer-overview-item">
                        <span className="executions-drawer-label">Completed</span>
                        <span className="executions-drawer-value">
                          {formatDate(details.completedAt)}
                        </span>
                      </div>

                      <div className="executions-drawer-overview-item">
                        <span className="executions-drawer-label">Duration</span>
                        <span className="executions-drawer-value executions-drawer-value--bold">
                          {timeline.totalDurationText}
                        </span>
                      </div>

                      {details.currentNodeId && (
                        <div className="executions-drawer-overview-item">
                          <span className="executions-drawer-label">Current Node</span>
                          <code className="executions-drawer-code">
                            {details.currentNodeId}
                          </code>
                        </div>
                      )}
                    </div>

                    {getErrorText(details.error) && (
                      <div className="executions-drawer-error-callout" role="alert">
                        <strong>Execution Error:</strong>
                        <p>{getErrorText(details.error)}</p>
                      </div>
                    )}
                  </div>

                  {/* Saga Execution-Level Compensation (if actually persisted) */}
                  {details.compensation && (
                    <div className="executions-page__execution-compensation">
                      <h3>Saga Compensation Overview</h3>
                      <div className="executions-drawer-overview-grid">
                        <div className="executions-drawer-overview-item">
                          <span className="executions-drawer-label">Compensation Status</span>
                          <span
                            className={`execution-status-pill execution-status-pill--${details.compensation.status}`}
                          >
                            {details.compensation.status}
                          </span>
                        </div>

                        {details.compensation.startedAt && (
                          <div className="executions-drawer-overview-item">
                            <span className="executions-drawer-label">Compensation Started</span>
                            <span className="executions-drawer-value">
                              {formatDate(details.compensation.startedAt)}
                            </span>
                          </div>
                        )}

                        {details.compensation.completedAt && (
                          <div className="executions-drawer-overview-item">
                            <span className="executions-drawer-label">Compensation Completed</span>
                            <span className="executions-drawer-value">
                              {formatDate(details.compensation.completedAt)}
                            </span>
                          </div>
                        )}
                      </div>

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

                  {/* Execution Timeline & Node Duration Insights */}
                  <section
                    className="executions-page__timeline-section"
                    aria-label="Execution timeline and node duration insights"
                  >
                    <div className="executions-page__timeline-header">
                      <h3>Sequential Execution Timeline</h3>
                      <span className="executions-page__timeline-step-count">
                        {timeline.steps.length} {timeline.steps.length === 1 ? 'step' : 'steps'}
                      </span>
                    </div>

                    <div className="executions-page__timeline-metrics-grid">
                      <div className="executions-page__timeline-metric">
                        <span className="executions-page__timeline-metric-label">Total Duration</span>
                        <span className="executions-page__timeline-metric-value">{timeline.totalDurationText}</span>
                      </div>

                      <div className="executions-page__timeline-metric">
                        <span className="executions-page__timeline-metric-label">Execution Status</span>
                        <span className={`execution-status-pill execution-status-pill--${details.status}`}>
                          {getStatusLabel(details.status)}
                        </span>
                      </div>

                      {timeline.slowestNode && (
                        <div className="executions-page__timeline-metric executions-page__timeline-metric--slowest">
                          <span className="executions-page__timeline-metric-label">Slowest Node</span>
                          <span
                            className="executions-page__timeline-metric-value"
                            title={`${timeline.slowestNode.label} (${timeline.slowestNode.durationText})`}
                          >
                            {timeline.slowestNode.label} ({timeline.slowestNode.durationText})
                          </span>
                        </div>
                      )}
                    </div>

                    {timeline.failedStep && (
                      <div className="executions-page__timeline-failure-box" role="alert">
                        <div className="executions-page__timeline-failure-title">
                          <strong>Failed at Step {timeline.failedStep.stepNumber}: {timeline.failedStep.label}</strong>
                          <code>{timeline.failedStep.nodeId}</code>
                        </div>
                        {timeline.failedStep.error && (
                          <p className="executions-page__timeline-failure-message">
                            {timeline.failedStep.error}
                          </p>
                        )}
                      </div>
                    )}

                    {!timeline.steps.length ? (
                      <p className="executions-page__empty-node-results">
                        No node execution steps were recorded for this execution.
                      </p>
                    ) : (
                      <ol className="executions-page__timeline-list" aria-label="Sequential execution steps">
                        <li className="executions-page__timeline-step executions-page__timeline-step--start">
                          <div className="executions-page__timeline-node-marker" aria-hidden="true">
                            <span className="executions-page__timeline-dot executions-page__timeline-dot--start" />
                          </div>
                          <div className="executions-page__timeline-step-body">
                            <div className="executions-page__timeline-step-title">
                              <span className="executions-page__timeline-tag">Start</span>
                              <strong>Execution Started</strong>
                            </div>
                            <span className="executions-page__timeline-timestamp">
                              {details.startedAt ? formatDate(details.startedAt) : 'Start time unavailable'}
                            </span>
                          </div>
                        </li>

                        {timeline.steps.map((step) => (
                          <li
                            key={`timeline-${step.stepNumber}-${step.nodeId}`}
                            className={`executions-page__timeline-step executions-page__timeline-step--${step.status}${step.isSlowest ? ' executions-page__timeline-step--slowest' : ''}`}
                          >
                            <div className="executions-page__timeline-node-marker" aria-hidden="true">
                              <span className={`executions-page__timeline-dot executions-page__timeline-dot--${step.status}`} />
                            </div>
                            <div className="executions-page__timeline-step-body">
                              <div className="executions-page__timeline-step-title">
                                <span className="executions-page__timeline-step-num">Step {step.stepNumber}</span>
                                <span className="executions-page__timeline-node-type">{step.nodeType || 'node'}</span>
                                <strong className="executions-page__timeline-step-label">{step.label}</strong>
                                <code className="executions-page__timeline-node-id">{step.nodeId}</code>
                                <span className={`execution-status-pill execution-status-pill--${step.status}`}>
                                  {step.status}
                                </span>
                                {step.isSlowest && (
                                  <span className="executions-page__timeline-slowest-badge">
                                    Slowest node
                                  </span>
                                )}
                              </div>

                              <div className="executions-page__timeline-step-details">
                                <span className="executions-page__timeline-duration">
                                  Duration: <strong>{step.durationText}</strong>
                                </span>
                              </div>

                              {step.error && (
                                <p className="executions-page__error" role="status">
                                  Error: {step.error}
                                </p>
                              )}

                              {step.compensation && (
                                <div className="executions-page__compensation">
                                  <p>
                                    <strong>Compensation status:</strong>{' '}
                                    <span className={`execution-status-pill execution-status-pill--${step.compensation.status}`}>
                                      {step.compensation.status}
                                    </span>
                                  </p>
                                  <p>
                                    <strong>Compensation duration:</strong> {step.compensation.durationText}
                                  </p>
                                  {step.compensation.error && (
                                    <p className="executions-page__error">
                                      Compensation error: {step.compensation.error}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          </li>
                        ))}

                        <li className={`executions-page__timeline-step executions-page__timeline-step--end executions-page__timeline-step--${details.status}`}>
                          <div className="executions-page__timeline-node-marker" aria-hidden="true">
                            <span className={`executions-page__timeline-dot executions-page__timeline-dot--${details.status}`} />
                          </div>
                          <div className="executions-page__timeline-step-body">
                            <div className="executions-page__timeline-step-title">
                              <span className="executions-page__timeline-tag">End</span>
                              <strong>Execution {getStatusLabel(details.status)}</strong>
                              <span className={`execution-status-pill execution-status-pill--${details.status}`}>
                                {getStatusLabel(details.status)}
                              </span>
                            </div>
                            <span className="executions-page__timeline-timestamp">
                              {details.completedAt
                                ? `Completed at: ${formatDate(details.completedAt)} (${timeline.totalDurationText})`
                                : 'Execution in progress'}
                            </span>
                          </div>
                        </li>
                      </ol>
                    )}
                  </section>

                  {/* Node Outputs & Step Payload Inspector */}
                  <h3 className="executions-drawer-subheading">Node Outputs & Payloads</h3>

                  {!details.nodeResults?.length ? (
                    <p className="executions-page__empty-node-results">
                      No node outputs were recorded for this execution.
                    </p>
                  ) : (
                    <ul className="executions-page__node-list">
                      {details.nodeResults.map((node, index) => (
                        <li key={`${node.nodeId}-${index}`}>
                          <div className="executions-drawer-node-header">
                            <strong>{node.nodeId}</strong>
                            <span className={`execution-status-pill execution-status-pill--${node.status}`}>
                              {node.status}
                            </span>
                          </div>

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
                                  className={`execution-status-pill execution-status-pill--${node.compensation.status}`}
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
        </div>
      )}
    </section>
  )
}

export default ExecutionsPage
