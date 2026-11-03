import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getExecutionSummary,
  type ExecutionSummary,
} from '../api/executionApi'
import {
  getWorkflows,
  type CreatedWorkflow,
} from '../api/workflowApi'
import {
  calculateCurrentlyRunning,
  formatDuration,
  formatPercentage,
} from '../executionHelpers'
import './AnalyticsPage.css'

export type AnalyticsPageProps = {
  tenantApiKey?: string
  onNavigate?: (page: string) => void
}

const CANONICAL_STATUSES: Array<{
  key: keyof Pick<
    ExecutionSummary,
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'compensating'
    | 'compensated'
    | 'compensationFailed'
  >
  label: string
  colorClass: string
}> = [
  { key: 'queued', label: 'Queued', colorClass: 'analytics-status--queued' },
  { key: 'running', label: 'Running', colorClass: 'analytics-status--running' },
  { key: 'completed', label: 'Completed', colorClass: 'analytics-status--completed' },
  { key: 'failed', label: 'Failed', colorClass: 'analytics-status--failed' },
  { key: 'compensating', label: 'Compensating', colorClass: 'analytics-status--compensating' },
  { key: 'compensated', label: 'Compensated', colorClass: 'analytics-status--compensated' },
  { key: 'compensationFailed', label: 'Compensation Failed', colorClass: 'analytics-status--compensation_failed' },
]

export default function AnalyticsPage({
  tenantApiKey,
  onNavigate,
}: AnalyticsPageProps) {
  const [workflows, setWorkflows] = useState<CreatedWorkflow[]>([])
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('')
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')
  const [dateValidationError, setDateValidationError] = useState<string>('')

  const [summary, setSummary] = useState<ExecutionSummary | null>(null)
  const [loading, setLoading] = useState<boolean>(() => Boolean(tenantApiKey?.trim()))
  const [error, setError] = useState<string>('')
  const [refreshToken, setRefreshToken] = useState<number>(0)

  // 1. Fetch saved workflows list to populate workflow filter
  useEffect(() => {
    let cancelled = false
    const apiKey = tenantApiKey?.trim()

    if (!apiKey) {
      queueMicrotask(() => {
        if (!cancelled) setWorkflows([])
      })
      return
    }

    async function loadWorkflows() {
      try {
        const result = await getWorkflows(apiKey!)
        if (!cancelled && Array.isArray(result?.workflows)) {
          setWorkflows(result.workflows)
        }
      } catch {
        // Workflow fetch failure is non-fatal for analytics summary
      }
    }

    void loadWorkflows()
    return () => {
      cancelled = true
    }
  }, [tenantApiKey])

  // 2. Fetch execution summary metrics with active filters
  const loadSummary = useCallback(async () => {
    const apiKey = tenantApiKey?.trim()
    if (!apiKey) {
      setSummary(null)
      setLoading(false)
      setError('API authentication is not configured.')
      return
    }

    // Validate date boundary: from <= to
    if (fromDate && toDate && new Date(fromDate).getTime() > new Date(toDate).getTime()) {
      setDateValidationError('The "From" date must be earlier than or equal to the "To" date.')
      return
    }
    setDateValidationError('')

    setLoading(true)
    setError('')

    try {
      const options: { workflowId?: string; from?: string; to?: string } = {}
      if (selectedWorkflowId) {
        options.workflowId = selectedWorkflowId
      }
      if (fromDate) {
        options.from = new Date(fromDate).toISOString()
      }
      if (toDate) {
        // Set to end of the day in ISO
        const endDay = new Date(toDate)
        endDay.setHours(23, 59, 59, 999)
        options.to = endDay.toISOString()
      }

      const res = await getExecutionSummary(apiKey, options)
      setSummary(res.summary)
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to retrieve execution summary analytics.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [tenantApiKey, selectedWorkflowId, fromDate, toDate])

  useEffect(() => {
    queueMicrotask(() => {
      void loadSummary()
    })
  }, [loadSummary, refreshToken])

  // Derive active filters state
  const hasActiveFilters = Boolean(selectedWorkflowId || fromDate || toDate)

  const clearFilters = () => {
    setSelectedWorkflowId('')
    setFromDate('')
    setToDate('')
    setDateValidationError('')
  }

  // Derive workflow label for scope badge
  const activeWorkflow = useMemo(() => {
    if (!selectedWorkflowId) return null
    return (
      workflows.find((w) => (w.id || w._id) === selectedWorkflowId) || null
    )
  }, [workflows, selectedWorkflowId])

  const totalTerminal = summary ? summary.completed + summary.unsuccessful : 0
  const runningActive = summary ? calculateCurrentlyRunning(summary) : 0

  return (
    <div className="analytics-page" role="main" aria-label="System Analytics and Observability">
      {/* 1. Breadcrumb */}
      <nav aria-label="Breadcrumb" className="analytics-page__breadcrumb">
        <span className="analytics-page__breadcrumb-item">Observability</span>
        <span className="analytics-page__breadcrumb-separator" aria-hidden="true">/</span>
        <span className="analytics-page__breadcrumb-current" aria-current="page">Analytics</span>
      </nav>

      {/* 2. Header */}
      <header className="analytics-page__header">
        <div className="analytics-page__header-main">
          <p className="analytics-page__eyebrow">Enterprise Observability</p>
          <h1>System Analytics &amp; Health</h1>
          <p>
            Real-time aggregate execution metrics, outcome distributions, and lifecycle performance.
          </p>
        </div>

        <div className="analytics-page__header-actions">
          <span
            className={`analytics-page__scope-badge ${
              activeWorkflow ? 'analytics-page__scope-badge--scoped' : ''
            }`}
            title="Scope of aggregated metrics"
          >
            {activeWorkflow ? `Scope: ${activeWorkflow.name}` : 'Scope: All Workflows (Tenant-wide)'}
          </span>

          <button
            type="button"
            className="analytics-page__refresh-btn"
            onClick={() => setRefreshToken((prev) => prev + 1)}
            disabled={loading}
            aria-label="Refresh analytics data"
          >
            {loading ? 'Refreshing…' : '↻ Refresh Data'}
          </button>
        </div>
      </header>

      {/* 3. Filter Toolbar */}
      <section className="analytics-page__filters" aria-label="Analytics scope and date filters">
        <div className="analytics-page__filter-group analytics-page__filter-group--workflow">
          <label htmlFor="analytics-workflow-select" className="analytics-page__filter-label">
            Workflow Scope
          </label>
          <select
            id="analytics-workflow-select"
            className="analytics-page__filter-select"
            value={selectedWorkflowId}
            onChange={(e) => setSelectedWorkflowId(e.target.value)}
            disabled={loading}
          >
            <option value="">All Workflows (Tenant-wide)</option>
            {workflows.map((wf) => {
              const id = wf.id || wf._id || ''
              return (
                <option key={id} value={id}>
                  {wf.name ?? 'Untitled Workflow'} (v{wf.version ?? 1})
                </option>
              )
            })}
          </select>
        </div>

        <div className="analytics-page__filter-group analytics-page__filter-group--date">
          <label htmlFor="analytics-from-date" className="analytics-page__filter-label">
            From Date
          </label>
          <input
            id="analytics-from-date"
            type="date"
            className="analytics-page__filter-input"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="analytics-page__filter-group analytics-page__filter-group--date">
          <label htmlFor="analytics-to-date" className="analytics-page__filter-label">
            To Date
          </label>
          <input
            id="analytics-to-date"
            type="date"
            className="analytics-page__filter-input"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            disabled={loading}
          />
        </div>

        {hasActiveFilters && (
          <div className="analytics-page__filter-actions">
            <button
              type="button"
              className="analytics-page__clear-btn"
              onClick={clearFilters}
              disabled={loading}
            >
              Reset Filters
            </button>
          </div>
        )}

        {dateValidationError && (
          <div className="analytics-page__date-validation-error" role="alert">
            {dateValidationError}
          </div>
        )}
      </section>

      {/* Error Callout */}
      {error && (
        <div className="analytics-page__error-banner" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="analytics-page__clear-btn"
            onClick={() => setRefreshToken((prev) => prev + 1)}
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && !summary && (
        <div className="analytics-skeleton-grid" role="status" aria-label="Loading analytics data">
          <div className="analytics-skeleton-card" />
          <div className="analytics-skeleton-card" />
          <div className="analytics-skeleton-card" />
          <div className="analytics-skeleton-card" />
        </div>
      )}

      {/* Unauthenticated State */}
      {!tenantApiKey?.trim() && !loading && (
        <div className="analytics-page__empty-state" role="status">
          <h3>Authentication Required</h3>
          <p>Configure a valid tenant API key in Settings to inspect enterprise observability metrics.</p>
        </div>
      )}

      {/* Main Analytics Content */}
      {summary && (
        <>
          {/* 4. Primary KPI Metrics Grid */}
          <section className="analytics-page__kpis" aria-label="Key Performance Indicators">
            {/* KPI 1: Total Executions */}
            <article className="analytics-kpi-card">
              <div className="analytics-kpi-card__header">
                <span className="analytics-kpi-card__label">Total Executions</span>
                <span className="analytics-kpi-card__badge analytics-kpi-card__badge--neutral">
                  Scope total
                </span>
              </div>
              <strong className="analytics-kpi-card__value">
                {summary.total.toLocaleString()}
              </strong>
              <p className="analytics-kpi-card__detail">
                {hasActiveFilters ? 'Filtered execution runs' : 'Tenant-wide executions'}
              </p>
            </article>

            {/* KPI 2: Completed */}
            <article className="analytics-kpi-card">
              <div className="analytics-kpi-card__header">
                <span className="analytics-kpi-card__label">Completed (Success)</span>
                <span className="analytics-kpi-card__badge analytics-kpi-card__badge--success">
                  Terminal
                </span>
              </div>
              <strong className="analytics-kpi-card__value analytics-kpi-card__value--success">
                {summary.completed.toLocaleString()}
              </strong>
              <p className="analytics-kpi-card__detail">
                Successful terminal executions
              </p>
            </article>

            {/* KPI 3: Failed */}
            <article className="analytics-kpi-card">
              <div className="analytics-kpi-card__header">
                <span className="analytics-kpi-card__label">Failed (Errors)</span>
                <span className="analytics-kpi-card__badge analytics-kpi-card__badge--error">
                  Terminal
                </span>
              </div>
              <strong className="analytics-kpi-card__value analytics-kpi-card__value--error">
                {summary.failed.toLocaleString()}
              </strong>
              <p className="analytics-kpi-card__detail">
                Failed execution runs
              </p>
            </article>

            {/* KPI 4: Currently Running */}
            <article className="analytics-kpi-card">
              <div className="analytics-kpi-card__header">
                <span className="analytics-kpi-card__label">Currently Active</span>
                <span className="analytics-kpi-card__badge analytics-kpi-card__badge--info">
                  In-Flight
                </span>
              </div>
              <strong className="analytics-kpi-card__value analytics-kpi-card__value--info">
                {runningActive.toLocaleString()}
              </strong>
              <p className="analytics-kpi-card__detail">
                {summary.running} running · {summary.compensating} compensating · {summary.queued} queued
              </p>
            </article>

            {/* KPI 5: Success Rate */}
            <article className="analytics-kpi-card">
              <div className="analytics-kpi-card__header">
                <span className="analytics-kpi-card__label">Success Rate</span>
                <span className="analytics-kpi-card__badge analytics-kpi-card__badge--accent">
                  Ratio
                </span>
              </div>
              <strong className="analytics-kpi-card__value analytics-kpi-card__value--accent">
                {totalTerminal > 0 ? `${summary.successRate}%` : '—'}
              </strong>
              <p className="analytics-kpi-card__detail">
                {totalTerminal > 0
                  ? `${summary.completed} of ${totalTerminal} terminal runs`
                  : 'No terminal executions to calculate'}
              </p>
            </article>

            {/* KPI 6: Failure Rate */}
            <article className="analytics-kpi-card">
              <div className="analytics-kpi-card__header">
                <span className="analytics-kpi-card__label">Unsuccessful Rate</span>
                <span className="analytics-kpi-card__badge analytics-kpi-card__badge--error">
                  Ratio
                </span>
              </div>
              <strong className="analytics-kpi-card__value analytics-kpi-card__value--error">
                {totalTerminal > 0 ? `${summary.failureRate}%` : '—'}
              </strong>
              <p className="analytics-kpi-card__detail">
                {totalTerminal > 0
                  ? `${summary.unsuccessful} of ${totalTerminal} terminal runs`
                  : 'No terminal executions to calculate'}
              </p>
            </article>

            {/* KPI 7: Average Duration */}
            <article className="analytics-kpi-card">
              <div className="analytics-kpi-card__header">
                <span className="analytics-kpi-card__label">Average Duration</span>
                <span className="analytics-kpi-card__badge analytics-kpi-card__badge--neutral">
                  Latency
                </span>
              </div>
              <strong className="analytics-kpi-card__value">
                {formatDuration(summary.avgDurationMs)}
              </strong>
              <p className="analytics-kpi-card__detail">
                {summary.avgDurationMs !== null
                  ? 'Persisted execution average'
                  : 'No valid timestamp data'}
              </p>
            </article>

            {/* KPI 8: Compensations */}
            <article className="analytics-kpi-card">
              <div className="analytics-kpi-card__header">
                <span className="analytics-kpi-card__label">Compensations</span>
                <span className="analytics-kpi-card__badge analytics-kpi-card__badge--accent">
                  Saga rollback
                </span>
              </div>
              <strong className="analytics-kpi-card__value">
                {(summary.compensated + summary.compensationFailed).toLocaleString()}
              </strong>
              <p className="analytics-kpi-card__detail">
                {summary.compensated} compensated · {summary.compensationFailed} failed
              </p>
            </article>
          </section>

          {/* 5. Execution Distribution & Outcomes */}
          <div className="analytics-page__grid">
            {/* Panel 1: Terminal Outcomes */}
            <article className="analytics-panel">
              <div className="analytics-panel__header">
                <div className="analytics-panel__title-group">
                  <h2>Terminal Execution Outcomes</h2>
                  <p>Proportion of completed versus unsuccessful executions.</p>
                </div>
                <span className="analytics-panel__badge">
                  {totalTerminal} terminal {totalTerminal === 1 ? 'run' : 'runs'}
                </span>
              </div>

              {totalTerminal === 0 ? (
                <div className="analytics-page__empty-state">
                  <p>No terminal execution records available to display outcome distribution.</p>
                </div>
              ) : (
                <>
                  <div
                    className="analytics-outcome-bar"
                    role="img"
                    aria-label={`Completed: ${formatPercentage(summary.successRate)}, Unsuccessful: ${formatPercentage(summary.failureRate)}`}
                  >
                    <span
                      className="analytics-outcome-bar__success"
                      style={{ width: `${summary.successRate}%` }}
                      title={`Completed: ${summary.completed} (${summary.successRate}%)`}
                    />
                    <span
                      className="analytics-outcome-bar__failure"
                      style={{ width: `${summary.failureRate}%` }}
                      title={`Unsuccessful: ${summary.unsuccessful} (${summary.failureRate}%)`}
                    />
                  </div>

                  <div className="analytics-outcome-legend">
                    <span className="analytics-outcome-legend__item">
                      <i className="analytics-legend-dot analytics-legend-dot--success" aria-hidden="true" />
                      Completed: <strong>{summary.completed} ({formatPercentage(summary.successRate)})</strong>
                    </span>
                    <span className="analytics-outcome-legend__item">
                      <i className="analytics-legend-dot analytics-legend-dot--error" aria-hidden="true" />
                      Unsuccessful: <strong>{summary.unsuccessful} ({formatPercentage(summary.failureRate)})</strong>
                    </span>
                  </div>

                  <p className="analytics-panel__footnote">
                    Per backend orchestration policy, unsuccessful outcomes include failed,
                    compensated, and compensation_failed runs.
                  </p>
                </>
              )}
            </article>

            {/* Panel 2: Canonical Status Breakdown (All 7 States) */}
            <article className="analytics-panel">
              <div className="analytics-panel__header">
                <div className="analytics-panel__title-group">
                  <h2>Lifecycle Status Breakdown</h2>
                  <p>Distribution across all canonical orchestration states.</p>
                </div>
                <span className="analytics-panel__badge">
                  {summary.total} total {summary.total === 1 ? 'record' : 'records'}
                </span>
              </div>

              {summary.total === 0 ? (
                <div className="analytics-page__empty-state">
                  <p>No executions have been initiated for this tenant.</p>
                </div>
              ) : (
                <ul className="analytics-status-list" aria-label="Execution status list">
                  {CANONICAL_STATUSES.map(({ key, label, colorClass }) => {
                    const count = Number(summary[key] ?? 0)
                    const percentage = summary.total > 0 ? (count / summary.total) * 100 : 0
                    return (
                      <li key={key} className="analytics-status-item">
                        <span className="analytics-status-item__label">
                          <i className={`analytics-status-item__dot ${colorClass}`} aria-hidden="true" />
                          {label}
                        </span>
                        <div className="analytics-status-item__bar-container">
                          <div
                            className={`analytics-status-item__bar ${colorClass}`}
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <span className="analytics-status-item__count">{count}</span>
                        <span className="analytics-status-item__pct">{percentage.toFixed(0)}%</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </article>
          </div>

          {/* 6. Performance & Duration Analytics */}
          <article className="analytics-panel analytics-panel--full-width">
            <div className="analytics-panel__header">
              <div className="analytics-panel__title-group">
                <h2>Performance &amp; Execution Latency</h2>
                <p>Execution duration analytics calculated from actual persisted timestamps.</p>
              </div>
              <span className="analytics-panel__badge">Duration Metrics</span>
            </div>

            <div className="analytics-duration-grid">
              <div className="analytics-duration-metric">
                <div className="analytics-duration-metric__label">Average Persisted Duration</div>
                <div className="analytics-duration-metric__value">
                  {formatDuration(summary.avgDurationMs)}
                </div>
                <p className="analytics-duration-metric__desc">
                  Derived from executions with verified startedAt and completedAt timestamps.
                  Runs lacking node-level timing are omitted to prevent statistical skew.
                </p>
              </div>

              <div className="analytics-duration-metric">
                <div className="analytics-duration-metric__label">Percentiles (P95 / P99) Policy</div>
                <div className="analytics-duration-metric__value" style={{ color: '#64748b' }}>
                  Withheld
                </div>
                <p className="analytics-duration-metric__desc">
                  The current MongoDB aggregation pipeline calculates scalar average duration.
                  Percentile metrics (P95/P99) are intentionally withheld to prevent displaying
                  fabricated statistical estimates.
                </p>
              </div>
            </div>

            {onNavigate && (
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '12px' }}>
                <button
                  type="button"
                  className="analytics-page__clear-btn"
                  onClick={() => onNavigate('Executions')}
                >
                  View Individual Execution Timelines →
                </button>
              </div>
            )}
          </article>

          {/* 7. Execution Trends (Honest State & API Contract Specification) */}
          <article className="analytics-panel analytics-panel--full-width">
            <div className="analytics-panel__header">
              <div className="analytics-panel__title-group">
                <h2>Execution Volume Over Time</h2>
                <p>Time-series historical trend analysis.</p>
              </div>
              <span className="analytics-panel__badge" style={{ color: '#d97706', borderColor: 'rgba(217, 119, 6, 0.3)' }}>
                Time-Series API Required
              </span>
            </div>

            <div className="analytics-deferred-card">
              <div className="analytics-deferred-card__header">
                <span style={{ fontSize: '18px' }} aria-hidden="true">⏱</span>
                <strong className="analytics-deferred-card__title">
                  Historical Time-Series Aggregation Deferred
                </strong>
              </div>
              <p>
                The existing orchestration engine provides point-in-time snapshot aggregates via{' '}
                <code>/api/executions/summary</code>. It does not currently expose a temporal
                bucketing pipeline (e.g. hourly or daily volume distribution). In compliance with
                enterprise data integrity rules, synthetic or interpolated curves are not rendered.
              </p>

              <div className="analytics-api-spec">
                <div className="analytics-api-spec__heading">
                  Required Backend Contract for Future Time-Series Charting:
                </div>
                <code>
{`GET /api/executions/analytics/timeseries?interval=day&from=ISO&to=ISO
Response Schema:
{
  "interval": "day",
  "buckets": [
    { "timestamp": "2026-11-01T00:00:00.000Z", "total": 14, "completed": 12, "failed": 2 },
    { "timestamp": "2026-11-02T00:00:00.000Z", "total": 28, "completed": 25, "failed": 3 }
  ]
}
MongoDB Implementation: $dateTrunc on $createdAt with $group stage.`}
                </code>
              </div>
            </div>
          </article>
        </>
      )}
    </div>
  )
}
