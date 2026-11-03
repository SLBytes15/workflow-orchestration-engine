import { useEffect, useMemo, useState } from 'react'
import {
  getExecutionSummary,
  getGlobalExecutions,
  type ExecutionSummary,
  type WorkflowExecution,
} from '../api/executionApi'
import {
  getWorkflows,
  type CreatedWorkflow,
  type WorkflowGraph,
} from '../api/workflowApi'
import WorkflowCard from '../components/workflows/WorkflowCard'
import {
  formatDuration,
  formatPercentage,
  getErrorText,
  sanitizeErrorMessage,
} from '../executionHelpers'
import {
  mapPersistedWorkflow,
  type Workflow,
} from '../workflowState'
import './DashboardPage.css'

type DashboardPageProps = {
  workflows: Workflow[]
  tenantApiKey?: string
  onNavigate: (page: string) => void
  onCreateWorkflow?: () => void
  onEditWorkflow?: (workflowId: string, graph: WorkflowGraph) => void
  onViewExecution?: (executionId: string) => void
}

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string }
  | { status: 'unavailable'; message: string }

const AUTH_MESSAGE = 'API authentication is not configured.'

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error
    ? sanitizeErrorMessage(error.message)
    : fallback
}

function mapSavedWorkflow(record: CreatedWorkflow): Workflow {
  const workflow = mapPersistedWorkflow(record)
  return {
    ...workflow,
    updatedAt:
      typeof record.updatedAt === 'string'
        ? record.updatedAt
        : '',
  }
}

function formatTimestamp(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function formatExecutionDuration(execution: WorkflowExecution): string {
  if (!execution.startedAt || !execution.completedAt) return '—'
  const startedAt = Date.parse(execution.startedAt)
  const completedAt = Date.parse(execution.completedAt)
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(completedAt) ||
    completedAt < startedAt
  ) {
    return '—'
  }
  return formatDuration(completedAt - startedAt)
}

function getExecutionId(execution: WorkflowExecution): string {
  return String(execution.id ?? execution._id ?? '')
}

function getExecutionStatusLabel(status: WorkflowExecution['status']): string {
  switch (status) {
    case 'compensation_failed':
      return 'Compensation failed'
    case 'compensating':
      return 'Compensating'
    case 'compensated':
      return 'Compensated'
    default:
      return status.charAt(0).toUpperCase() + status.slice(1)
  }
}

const statusRows: Array<{
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
}> = [
  { key: 'queued', label: 'Queued' },
  { key: 'running', label: 'Running' },
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
  { key: 'compensating', label: 'Compensating' },
  { key: 'compensated', label: 'Compensated' },
  { key: 'compensationFailed', label: 'Compensation failed' },
]

function DashboardPage({
  workflows,
  tenantApiKey,
  onNavigate,
  onCreateWorkflow,
  onEditWorkflow,
  onViewExecution,
}: DashboardPageProps) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [savedWorkflows, setSavedWorkflows] = useState<LoadState<Workflow[]>>({
    status: 'loading',
  })
  const [summary, setSummary] = useState<LoadState<ExecutionSummary>>({
    status: 'loading',
  })
  const [recentExecutions, setRecentExecutions] = useState<
    LoadState<WorkflowExecution[]>
  >({ status: 'loading' })
  const [recentFailures, setRecentFailures] = useState<
    LoadState<WorkflowExecution[]>
  >({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    const apiKey = tenantApiKey?.trim() || ''

    async function loadDashboardData() {
      await Promise.resolve()
      if (cancelled) return

      if (!apiKey) {
        setSavedWorkflows({ status: 'unavailable', message: AUTH_MESSAGE })
        setSummary({ status: 'unavailable', message: AUTH_MESSAGE })
        setRecentExecutions({ status: 'unavailable', message: AUTH_MESSAGE })
        setRecentFailures({ status: 'unavailable', message: AUTH_MESSAGE })
        return
      }

      setSavedWorkflows({ status: 'loading' })
      setSummary({ status: 'loading' })
      setRecentExecutions({ status: 'loading' })
      setRecentFailures({ status: 'loading' })

      const results = await Promise.allSettled([
        getWorkflows(apiKey).then((result) =>
          result.workflows.map(mapSavedWorkflow),
        ),
        getExecutionSummary(apiKey),
        getGlobalExecutions(apiKey, { limit: 6 }).then(
          (result) => result.executions,
        ),
        getGlobalExecutions(apiKey, { status: 'failed', limit: 5 }).then(
          (result) => result.executions,
        ),
      ])

      if (cancelled) return

      const [workflowResult, summaryResult, executionResult, failureResult] =
        results

      setSavedWorkflows(
        workflowResult.status === 'fulfilled'
          ? { status: 'success', data: workflowResult.value }
          : {
              status: 'error',
              message: getErrorMessage(
                workflowResult.reason,
                'Unable to load saved workflows.',
              ),
            },
      )
      setSummary(
        summaryResult.status === 'fulfilled'
          ? { status: 'success', data: summaryResult.value.summary }
          : {
              status: 'error',
              message: getErrorMessage(
                summaryResult.reason,
                'Unable to load execution metrics.',
              ),
            },
      )
      setRecentExecutions(
        executionResult.status === 'fulfilled'
          ? { status: 'success', data: executionResult.value }
          : {
              status: 'error',
              message: getErrorMessage(
                executionResult.reason,
                'Unable to load recent executions.',
              ),
            },
      )
      setRecentFailures(
        failureResult.status === 'fulfilled'
          ? { status: 'success', data: failureResult.value }
          : {
              status: 'error',
              message: getErrorMessage(
                failureResult.reason,
                'Unable to load recent failures.',
              ),
            },
      )
    }

    void loadDashboardData()

    return () => {
      cancelled = true
    }
  }, [tenantApiKey, refreshKey])

  const workflowStats = useMemo(() => {
    if (savedWorkflows.status !== 'success') return null
    return {
      total: savedWorkflows.data.length,
      active: savedWorkflows.data.filter((workflow) => workflow.status === 'Active')
        .length,
      draft: savedWorkflows.data.filter((workflow) => workflow.status === 'Draft')
        .length,
      paused: savedWorkflows.data.filter((workflow) => workflow.status === 'Paused')
        .length,
    }
  }, [savedWorkflows])

  const workflowNameById = useMemo(() => {
    const records =
      savedWorkflows.status === 'success' ? savedWorkflows.data : workflows
    return new Map(records.map((workflow) => [String(workflow.id), workflow.name]))
  }, [savedWorkflows, workflows])

  const displayedWorkflows = useMemo(() => {
    const records =
      savedWorkflows.status === 'success'
        ? savedWorkflows.data
        : workflows.filter((workflow) => workflow.isPersisted)
    return [...records]
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, 4)
  }, [savedWorkflows, workflows])

  const recentWorkflowNote =
    savedWorkflows.status === 'success'
      ? ''
      : savedWorkflows.status === 'error'
        ? 'Showing saved workflow records available in this session; the latest list could not be refreshed.'
        : savedWorkflows.status === 'unavailable'
          ? 'Connect API authentication to load saved workflow activity.'
          : ''

  function renderMetricValue(
    state: LoadState<ExecutionSummary>,
    selectValue: (data: ExecutionSummary) => string | number,
  ) {
    return state.status === 'success' ? selectValue(state.data) : '—'
  }

  function renderMetricDetail(
    state: LoadState<ExecutionSummary> | LoadState<Workflow[]>,
    detail: string,
  ) {
    if (state.status === 'loading') return 'Loading…'
    if (state.status === 'success') return detail
    return 'Data unavailable'
  }

  return (
    <section className="dashboard-page" aria-label="Dashboard Overview">
      <header className="dashboard-page__header">
        <div>
          <p className="dashboard-page__eyebrow">SYSTEM OVERVIEW</p>
          <h1 className="dashboard-page__title">Dashboard</h1>
          <p className="dashboard-page__subtitle">
            Workflow and execution health at a glance.
          </p>
        </div>

        <div className="dashboard-page__header-actions">
          <button
            type="button"
            className="dashboard-page__btn dashboard-page__btn--primary"
            onClick={() => {
              if (onCreateWorkflow) {
                onCreateWorkflow()
              } else {
                onNavigate('Workflows')
              }
            }}
          >
            Create workflow
          </button>
          <button
            type="button"
            className="dashboard-page__refresh"
            onClick={() => setRefreshKey((current) => current + 1)}
            aria-label="Refresh dashboard data"
          >
            Refresh
          </button>
        </div>
      </header>

      <section
        className="dashboard-section"
        aria-labelledby="dashboard-workflow-metrics"
        aria-busy={savedWorkflows.status === 'loading'}
      >
        <div className="dashboard-section__heading">
          <div>
            <h2 id="dashboard-workflow-metrics">Workflows</h2>
            <p>Saved workflow definitions by current status.</p>
          </div>
        </div>
        {(savedWorkflows.status === 'error' ||
          savedWorkflows.status === 'unavailable') && (
          <div
            className={`dashboard-inline-message ${
              savedWorkflows.status === 'error'
                ? 'dashboard-inline-message--error'
                : ''
            }`}
            role={savedWorkflows.status === 'error' ? 'alert' : 'status'}
          >
            <span>
              Workflow data unavailable: {savedWorkflows.message}
            </span>
            {savedWorkflows.status === 'error' && (
              <button
                type="button"
                className="dashboard-retry"
                onClick={() => setRefreshKey((current) => current + 1)}
              >
                Retry
              </button>
            )}
          </div>
        )}
        <div className="dashboard-kpi-grid dashboard-kpi-grid--workflow">
          <article className="dashboard-kpi">
            <span className="dashboard-kpi__label">Total workflows</span>
            <strong className="dashboard-kpi__value">
              {workflowStats?.total ?? '—'}
            </strong>
            <span className="dashboard-kpi__detail">
              {renderMetricDetail(savedWorkflows, 'Saved definitions')}
            </span>
          </article>
          <article className="dashboard-kpi dashboard-kpi--success">
            <span className="dashboard-kpi__label">Active</span>
            <strong className="dashboard-kpi__value">
              {workflowStats?.active ?? '—'}
            </strong>
            <span className="dashboard-kpi__detail">
              {renderMetricDetail(savedWorkflows, 'Ready to execute')}
            </span>
          </article>
          <article className="dashboard-kpi dashboard-kpi--warning">
            <span className="dashboard-kpi__label">Draft</span>
            <strong className="dashboard-kpi__value">
              {workflowStats?.draft ?? '—'}
            </strong>
            <span className="dashboard-kpi__detail">
              {renderMetricDetail(savedWorkflows, 'Not yet active')}
            </span>
          </article>
          <article className="dashboard-kpi">
            <span className="dashboard-kpi__label">Paused</span>
            <strong className="dashboard-kpi__value">
              {workflowStats?.paused ?? '—'}
            </strong>
            <span className="dashboard-kpi__detail">
              {renderMetricDetail(savedWorkflows, 'Temporarily inactive')}
            </span>
          </article>
        </div>
      </section>

      <section
        className="dashboard-section"
        aria-labelledby="dashboard-execution-metrics"
        aria-busy={summary.status === 'loading'}
      >
        <div className="dashboard-section__heading">
          <div>
            <h2 id="dashboard-execution-metrics">Execution health</h2>
            <p>Tenant-scoped aggregate metrics from the execution service.</p>
          </div>
        </div>

        {(summary.status === 'error' || summary.status === 'unavailable') && (
          <div
            className={`dashboard-inline-message ${
              summary.status === 'error'
                ? 'dashboard-inline-message--error'
                : ''
            }`}
            role={summary.status === 'error' ? 'alert' : 'status'}
          >
            <span>Execution metrics unavailable: {summary.message}</span>
            {summary.status === 'error' && (
              <button
                type="button"
                className="dashboard-retry"
                onClick={() => setRefreshKey((current) => current + 1)}
              >
                Retry
              </button>
            )}
          </div>
        )}

        <div className="dashboard-kpi-grid dashboard-kpi-grid--execution">
          <article className="dashboard-kpi">
            <span className="dashboard-kpi__label">Total executions</span>
            <strong className="dashboard-kpi__value">
              {renderMetricValue(summary, (data) => data.total)}
            </strong>
            <span className="dashboard-kpi__detail">
              {renderMetricDetail(summary, 'Matching execution records')}
            </span>
          </article>
          <article className="dashboard-kpi dashboard-kpi--info">
            <span className="dashboard-kpi__label">Running</span>
            <strong className="dashboard-kpi__value">
              {renderMetricValue(summary, (data) => data.running)}
            </strong>
            <span className="dashboard-kpi__detail">
              {summary.status === 'success'
                ? `${summary.data.queued} queued · ${summary.data.compensating} compensating`
                : renderMetricDetail(summary, '')}
            </span>
          </article>
          <article className="dashboard-kpi dashboard-kpi--error">
            <span className="dashboard-kpi__label">Failed</span>
            <strong className="dashboard-kpi__value">
              {renderMetricValue(summary, (data) => data.failed)}
            </strong>
            <span className="dashboard-kpi__detail">
              {renderMetricDetail(summary, 'Failed execution status')}
            </span>
          </article>
          <article className="dashboard-kpi dashboard-kpi--success">
            <span className="dashboard-kpi__label">Success rate</span>
            <strong className="dashboard-kpi__value">
              {renderMetricValue(summary, (data) =>
                data.completed + data.unsuccessful === 0
                  ? '—'
                  : formatPercentage(data.successRate),
              )}
            </strong>
            <span className="dashboard-kpi__detail">
              {summary.status === 'success' &&
              summary.data.completed + summary.data.unsuccessful === 0
                ? 'No terminal executions to calculate a rate'
                : renderMetricDetail(summary, 'Completed / terminal executions')}
            </span>
          </article>
          <article className="dashboard-kpi">
            <span className="dashboard-kpi__label">Average duration</span>
            <strong className="dashboard-kpi__value dashboard-kpi__value--duration">
              {renderMetricValue(summary, (data) =>
                formatDuration(data.avgDurationMs),
              )}
            </strong>
            <span className="dashboard-kpi__detail">
              {summary.status === 'success' && summary.data.avgDurationMs === null
                ? 'No completed duration data'
                : renderMetricDetail(summary, 'Average persisted execution duration')}
            </span>
          </article>
        </div>

        <div className="dashboard-analytics-grid">
          <article className="dashboard-panel dashboard-trend-panel">
            <div className="dashboard-panel__heading">
              <div>
                <h3>Execution volume</h3>
                <p>Historical activity over time</p>
              </div>
              <span className="dashboard-panel__badge">Trend unavailable</span>
            </div>
            <div className="dashboard-unavailable-state" role="status">
              <strong>Time-series data is not available</strong>
              <p>
                The current summary API returns aggregate counts, not time-bucketed
                history. No chart is shown until historical data is available.
              </p>
            </div>
          </article>

          <article className="dashboard-panel">
            <div className="dashboard-panel__heading">
              <div>
                <h3>Success and unsuccessful</h3>
                <p>Terminal execution outcomes</p>
              </div>
            </div>
            {summary.status === 'success' ? (
              summary.data.completed + summary.data.unsuccessful === 0 ? (
                <div className="dashboard-empty-inline">
                  No terminal executions to summarize.
                </div>
              ) : (
                <>
                  <div
                    className="dashboard-outcome-bar"
                    role="img"
                    aria-label={`Success rate ${formatPercentage(summary.data.successRate)}; unsuccessful rate ${formatPercentage(summary.data.failureRate)}`}
                  >
                    <span
                      className="dashboard-outcome-bar__success"
                      style={{ width: `${summary.data.successRate}%` }}
                    />
                    <span
                      className="dashboard-outcome-bar__failure"
                      style={{ width: `${summary.data.failureRate}%` }}
                    />
                  </div>
                  <div className="dashboard-outcome-legend">
                    <span>
                      <i className="dashboard-legend-dot dashboard-legend-dot--success" />
                      Completed <strong>{formatPercentage(summary.data.successRate)}</strong>
                    </span>
                    <span>
                      <i className="dashboard-legend-dot dashboard-legend-dot--error" />
                      Unsuccessful <strong>{formatPercentage(summary.data.failureRate)}</strong>
                    </span>
                  </div>
                  <p className="dashboard-panel__footnote">
                    Unsuccessful includes failed, compensated and compensation-failed
                    executions, per the current backend calculation.
                  </p>
                </>
              )
            ) : summary.status === 'loading' ? (
              <div className="dashboard-empty-inline" role="status">
                Loading outcome data…
              </div>
            ) : (
              <div className="dashboard-empty-inline" role="status">
                {summary.message}
              </div>
            )}
          </article>

          <article className="dashboard-panel dashboard-status-panel">
            <div className="dashboard-panel__heading">
              <div>
                <h3>Execution status</h3>
                <p>Current aggregate status counts</p>
              </div>
            </div>
            {summary.status === 'success' ? (
              summary.data.total === 0 ? (
                <div className="dashboard-empty-inline">
                  No executions are available.
                </div>
              ) : (
                <ul className="dashboard-status-list">
                  {statusRows.map(({ key, label }) => {
                    const count = summary.data[key]
                    const width =
                      summary.data.total > 0
                        ? Math.min((count / summary.data.total) * 100, 100)
                        : 0
                    return (
                      <li className="dashboard-status-row" key={key}>
                        <span className="dashboard-status-row__label">{label}</span>
                        <span className="dashboard-status-row__track">
                          <span
                            className={`dashboard-status-row__bar dashboard-status-row__bar--${key}`}
                            style={{ width: `${width}%` }}
                          />
                        </span>
                        <strong>{count}</strong>
                      </li>
                    )
                  })}
                </ul>
              )
            ) : summary.status === 'loading' ? (
              <div className="dashboard-empty-inline" role="status">
                Loading status counts…
              </div>
            ) : (
              <div className="dashboard-empty-inline" role="status">
                {summary.message}
              </div>
            )}
          </article>
        </div>
      </section>

      <section
        className="dashboard-section"
        aria-labelledby="dashboard-recent-executions"
        aria-busy={recentExecutions.status === 'loading'}
      >
        <div className="dashboard-section__heading">
          <div>
            <h2 id="dashboard-recent-executions">Recent executions</h2>
            <p>Latest execution records returned by the backend.</p>
          </div>
        </div>
        <div className="dashboard-panel dashboard-table-wrap">
          {recentExecutions.status === 'loading' ? (
            <p className="dashboard-state" role="status">Loading recent executions…</p>
          ) : recentExecutions.status === 'success' ? (
            recentExecutions.data.length === 0 ? (
              <p className="dashboard-state">No executions found.</p>
            ) : (
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th scope="col">Execution ID</th>
                    <th scope="col">Workflow</th>
                    <th scope="col">Status</th>
                    <th scope="col">Started</th>
                    <th scope="col">Duration</th>
                    <th scope="col"><span className="dashboard-visually-hidden">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {recentExecutions.data.map((execution, index) => {
                    const id = getExecutionId(execution)
                    return (
                      <tr key={id || `${execution.workflowId}-${index}`}>
                        <td className="dashboard-table__id" data-label="Execution ID">
                          {id || '—'}
                        </td>
                        <td data-label="Workflow">
                          {workflowNameById.get(String(execution.workflowId)) ??
                            String(execution.workflowId)}
                        </td>
                        <td data-label="Status">
                          <span
                            className={`dashboard-status-badge dashboard-status-badge--${execution.status}`}
                          >
                            {getExecutionStatusLabel(execution.status)}
                          </span>
                        </td>
                        <td data-label="Started">
                          {formatTimestamp(execution.startedAt)}
                        </td>
                        <td data-label="Duration">
                          {formatExecutionDuration(execution)}
                        </td>
                        <td data-label="Actions">
                          {id && onViewExecution && (
                            <button
                              type="button"
                              className="dashboard-row-action"
                              onClick={() => onViewExecution(id)}
                            >
                              View details
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          ) : recentExecutions.status === 'error' ? (
            <div className="dashboard-state dashboard-state--error" role="alert">
              <span>Recent executions unavailable: {recentExecutions.message}</span>
              <button
                type="button"
                className="dashboard-retry"
                onClick={() => setRefreshKey((current) => current + 1)}
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="dashboard-state" role="status">
              {recentExecutions.message}
            </div>
          )}
        </div>
      </section>

      <div className="dashboard-lower-grid">
        <section
          className="dashboard-section"
          aria-labelledby="dashboard-recent-failures"
          aria-busy={recentFailures.status === 'loading'}
        >
          <div className="dashboard-section__heading">
            <div>
              <h2 id="dashboard-recent-failures">Recent failures</h2>
              <p>Executions with the failed status.</p>
            </div>
          </div>
          <div className="dashboard-panel dashboard-failures">
            {recentFailures.status === 'loading' ? (
              <p className="dashboard-state" role="status">Loading failures…</p>
            ) : recentFailures.status === 'success' ? (
              recentFailures.data.length === 0 ? (
                <p className="dashboard-state">No failed executions found.</p>
              ) : (
                <ul className="dashboard-failure-list">
                  {recentFailures.data.map((execution, index) => {
                    const id = getExecutionId(execution)
                    const error = getErrorText(execution.error)
                    return (
                      <li className="dashboard-failure-item" key={id || `${index}`}>
                        <div className="dashboard-failure-item__main">
                          <strong>{id || 'Execution ID unavailable'}</strong>
                          <span>
                            {workflowNameById.get(String(execution.workflowId)) ??
                              String(execution.workflowId)}
                          </span>
                          <span>
                            <span
                              className={`dashboard-status-badge dashboard-status-badge--${execution.status}`}
                            >
                              {getExecutionStatusLabel(execution.status)}
                            </span>
                          </span>
                          <span className="dashboard-failure-item__date">
                            {formatTimestamp(execution.startedAt ?? execution.createdAt)}
                          </span>
                          {error && <p>{error}</p>}
                        </div>
                        {id && onViewExecution && (
                          <button
                            type="button"
                            className="dashboard-row-action"
                            onClick={() => onViewExecution(id)}
                          >
                            Details
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )
            ) : recentFailures.status === 'error' ? (
              <div className="dashboard-state dashboard-state--error" role="alert">
                <span>Recent failures unavailable: {recentFailures.message}</span>
                <button
                  type="button"
                  className="dashboard-retry"
                  onClick={() => setRefreshKey((current) => current + 1)}
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="dashboard-state" role="status">
                {recentFailures.message}
              </div>
            )}
          </div>
        </section>

        <section
          className="dashboard-section"
          aria-labelledby="dashboard-recent-workflows"
          aria-busy={savedWorkflows.status === 'loading'}
        >
          <div className="dashboard-section__heading">
            <div>
              <h2 id="dashboard-recent-workflows">Recent workflows</h2>
              <p>Saved definitions and their latest available metadata.</p>
            </div>
          </div>
          {recentWorkflowNote && (
            <div
              className={`dashboard-inline-message ${
                savedWorkflows.status === 'error'
                  ? 'dashboard-inline-message--error'
                  : ''
              }`}
              role={savedWorkflows.status === 'error' ? 'alert' : 'status'}
            >
              {recentWorkflowNote}
              {savedWorkflows.status === 'error' && (
                <button
                  type="button"
                  className="dashboard-retry"
                  onClick={() => setRefreshKey((current) => current + 1)}
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {savedWorkflows.status === 'loading' ? (
            <div className="dashboard-panel">
              <p className="dashboard-state" role="status">
                Loading saved workflow activity…
              </p>
            </div>
          ) : savedWorkflows.status === 'success' &&
            displayedWorkflows.length === 0 ? (
            <div className="dashboard-panel dashboard-empty-workflows">
              <strong>No workflows yet</strong>
              <p>Create a workflow to see it in this overview.</p>
              <button
                type="button"
                className="dashboard-page__btn dashboard-page__btn--primary"
                onClick={() => {
                  if (onCreateWorkflow) onCreateWorkflow()
                  else onNavigate('Workflows')
                }}
              >
                Create workflow
              </button>
            </div>
          ) : displayedWorkflows.length === 0 ? (
            <div
              className={`dashboard-panel dashboard-state ${
                savedWorkflows.status === 'error'
                  ? 'dashboard-state--error'
                  : ''
              }`}
              role={savedWorkflows.status === 'error' ? 'alert' : 'status'}
            >
              No saved workflow records are available.
            </div>
          ) : (
            <div className="dashboard-workflow-grid">
              {displayedWorkflows.map((workflow) => (
                <WorkflowCard
                  key={workflow.id}
                  name={workflow.name}
                  description={workflow.description}
                  status={workflow.status}
                  version={workflow.version}
                  updatedAt={
                    workflow.updatedAt
                      ? formatTimestamp(workflow.updatedAt)
                      : undefined
                  }
                  onOpen={
                    workflow.isPersisted && workflow.graph && onEditWorkflow
                      ? () => onEditWorkflow(String(workflow.id), workflow.graph!)
                      : undefined
                  }
                  onEdit={
                    workflow.isPersisted && workflow.graph && onEditWorkflow
                      ? () => onEditWorkflow(String(workflow.id), workflow.graph!)
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <section
        className="dashboard-section dashboard-quick-actions"
        aria-labelledby="dashboard-quick-actions"
      >
        <div className="dashboard-section__heading">
          <div>
            <h2 id="dashboard-quick-actions">Quick actions</h2>
            <p>Jump to the workspace areas you use most.</p>
          </div>
        </div>
        <div className="dashboard-quick-actions__links">
          <button
            type="button"
            className="dashboard-page__btn dashboard-page__btn--secondary"
            onClick={() => onNavigate('Node Preview')}
          >
            Open workflow builder
          </button>
          <button
            type="button"
            className="dashboard-page__btn dashboard-page__btn--secondary"
            onClick={() => onNavigate('Workflows')}
          >
            Open workflow catalog
          </button>
          <button
            type="button"
            className="dashboard-page__btn dashboard-page__btn--secondary"
            onClick={() => onNavigate('Executions')}
          >
            View execution history
          </button>
          <button
            type="button"
            className="dashboard-page__btn dashboard-page__btn--secondary"
            onClick={() => onNavigate('Analytics')}
          >
            View system analytics
          </button>
        </div>
      </section>
    </section>
  )
}

export default DashboardPage
