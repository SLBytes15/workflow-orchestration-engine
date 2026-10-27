import { useMemo } from 'react'
import WorkflowCard from '../components/workflows/WorkflowCard'
import type { Workflow } from '../workflowState'
import type { WorkflowGraph } from '../api/workflowApi'
import './DashboardPage.css'

type DashboardPageProps = {
  workflows: Workflow[]
  tenantApiKey?: string
  onNavigate: (page: string) => void
  onCreateWorkflow?: () => void
  onEditWorkflow?: (workflowId: string, graph: WorkflowGraph) => void
}

function DashboardPage({
  workflows,
  onNavigate,
  onCreateWorkflow,
  onEditWorkflow,
}: DashboardPageProps) {
  const stats = useMemo(() => {
    const total = workflows.length
    const active = workflows.filter((w) => w.status === 'Active').length
    const draft = workflows.filter((w) => w.status === 'Draft').length
    const paused = workflows.filter((w) => w.status === 'Paused').length

    return { total, active, draft, paused }
  }, [workflows])

  const recentWorkflows = useMemo(() => {
    return [...workflows]
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, 4)
  }, [workflows])

  return (
    <section className="dashboard-page" aria-label="Dashboard Overview">
      <header className="dashboard-page__header">
        <div>
          <p className="dashboard-page__eyebrow">SYSTEM OVERVIEW</p>
          <h1 className="dashboard-page__title">Dashboard</h1>
          <p className="dashboard-page__subtitle">
            Monitor workflow health, operational metrics, and quick actions.
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
            <span aria-hidden="true">+</span> Create workflow
          </button>
          <button
            type="button"
            className="dashboard-page__btn dashboard-page__btn--secondary"
            onClick={() => onNavigate('Workflows')}
          >
            All workflows
          </button>
        </div>
      </header>

      {/* Metric Cards Row */}
      <section className="dashboard-page__stats" aria-label="Workflow Statistics">
        <article className="dashboard-stat-card dashboard-stat-card--total">
          <div className="dashboard-stat-card__header">
            <span className="dashboard-stat-card__label">Total Workflows</span>
            <span className="dashboard-stat-card__icon" aria-hidden="true">📊</span>
          </div>
          <div className="dashboard-stat-card__value">{stats.total}</div>
          <p className="dashboard-stat-card__detail">Defined across the system</p>
        </article>

        <article className="dashboard-stat-card dashboard-stat-card--active">
          <div className="dashboard-stat-card__header">
            <span className="dashboard-stat-card__label">Active</span>
            <span className="dashboard-stat-card__badge dashboard-stat-card__badge--active">Active</span>
          </div>
          <div className="dashboard-stat-card__value">{stats.active}</div>
          <p className="dashboard-stat-card__detail">Ready for execution</p>
        </article>

        <article className="dashboard-stat-card dashboard-stat-card--draft">
          <div className="dashboard-stat-card__header">
            <span className="dashboard-stat-card__label">Draft</span>
            <span className="dashboard-stat-card__badge dashboard-stat-card__badge--draft">Draft</span>
          </div>
          <div className="dashboard-stat-card__value">{stats.draft}</div>
          <p className="dashboard-stat-card__detail">Under development</p>
        </article>

        <article className="dashboard-stat-card dashboard-stat-card--paused">
          <div className="dashboard-stat-card__header">
            <span className="dashboard-stat-card__label">Paused</span>
            <span className="dashboard-stat-card__badge dashboard-stat-card__badge--paused">Paused</span>
          </div>
          <div className="dashboard-stat-card__value">{stats.paused}</div>
          <p className="dashboard-stat-card__detail">Temporarily halted</p>
        </article>
      </section>

      {/* Quick Launch Cards */}
      <section className="dashboard-page__quick-actions" aria-label="Quick Actions">
        <div className="dashboard-action-card">
          <div className="dashboard-action-card__icon" aria-hidden="true">✨</div>
          <div className="dashboard-action-card__content">
            <h3>Guided Wizard</h3>
            <p>Step-by-step workflow builder designed for beginners without graph theory complexity.</p>
          </div>
          <button
            type="button"
            className="dashboard-page__btn dashboard-page__btn--primary"
            onClick={() => onNavigate('Node Preview')}
          >
            Launch Builder →
          </button>
        </div>

        <div className="dashboard-action-card">
          <div className="dashboard-action-card__icon" aria-hidden="true">🗂️</div>
          <div className="dashboard-action-card__content">
            <h3>Workflow Catalog</h3>
            <p>Filter, search, run executions, and inspect details of all existing workflows.</p>
          </div>
          <button
            type="button"
            className="dashboard-page__btn dashboard-page__btn--secondary"
            onClick={() => onNavigate('Workflows')}
          >
            Manage Catalog →
          </button>
        </div>

        <div className="dashboard-action-card">
          <div className="dashboard-action-card__icon" aria-hidden="true">⚡</div>
          <div className="dashboard-action-card__content">
            <h3>Executions & Traces</h3>
            <p>Monitor real-time workflow runs, node execution outcomes, and compensation logs.</p>
          </div>
          <button
            type="button"
            className="dashboard-page__btn dashboard-page__btn--secondary"
            onClick={() => onNavigate('Executions')}
          >
            View Executions →
          </button>
        </div>
      </section>

      {/* Recent Workflows */}
      <section className="dashboard-page__recent" aria-label="Recent Workflows">
        <div className="dashboard-page__section-header">
          <div>
            <h2>Recent Workflows</h2>
            <p className="dashboard-page__section-subtitle">
              Recently updated workflow definitions
            </p>
          </div>
          {workflows.length > 0 && (
            <button
              type="button"
              className="dashboard-page__link-button"
              onClick={() => onNavigate('Workflows')}
            >
              View all ({workflows.length}) →
            </button>
          )}
        </div>

        {recentWorkflows.length === 0 ? (
          <div className="dashboard-page__empty">
            <p className="dashboard-page__empty-title">No workflows defined yet</p>
            <p className="dashboard-page__empty-desc">
              Create your first workflow to see it here and start automating tasks.
            </p>
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
              + Create your first workflow
            </button>
          </div>
        ) : (
          <div className="dashboard-page__grid">
            {recentWorkflows.map((workflow) => (
              <WorkflowCard
                key={workflow.id}
                name={workflow.name}
                description={workflow.description}
                status={workflow.status}
                version={workflow.version}
                updatedAt={workflow.updatedAt}
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
    </section>
  )
}

export default DashboardPage

