
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import WorkflowCard from '../components/workflows/WorkflowCard'
import WorkflowListState from '../components/workflows/WorkflowListState'
import {
  createWorkflow,
  getWorkflows,
  type WorkflowGraph,
} from '../api/workflowApi'
import './WorkflowsPage.css'

type WorkflowStatus = 'Active' | 'Draft' | 'Paused'

type Workflow = {
  id: string | number
  name: string
  description: string
  status: WorkflowStatus
  version: number
  updatedAt: string
}

type WorkflowsPageProps = {
  graph: WorkflowGraph | null
  tenantApiKey?: string
}

const initialWorkflows: Workflow[] = [
  {
    id: 1,
    name: 'Payment Processing',
    description: 'Handles payment-related workflow operations.',
    status: 'Active',
    version: 1,
    updatedAt: '2026-10-10',
  },
  {
    id: 2,
    name: 'Order Management',
    description: 'Manages order creation, tracking, and completion.',
    status: 'Draft',
    version: 2,
    updatedAt: '2026-10-09',
  },
  {
    id: 3,
    name: 'Customer Notifications',
    description: 'Sends notifications to customers.',
    status: 'Paused',
    version: 1,
    updatedAt: '2026-10-08',
  },
]

function WorkflowsPage({
  graph,
  tenantApiKey,
}: WorkflowsPageProps) {
  const [workflows, setWorkflows] =
    useState<Workflow[]>(initialWorkflows)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [nameError, setNameError] = useState('')
  const [apiError, setApiError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingSavedWorkflows, setIsLoadingSavedWorkflows] = useState(Boolean(tenantApiKey?.trim()))
  const [workflowLoadError, setWorkflowLoadError] = useState('')
  const [workflowReloadKey, setWorkflowReloadKey] = useState(0)

  const createButtonRef = useRef<HTMLButtonElement>(null)
  const modalRef = useRef<HTMLElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const closeCreateModal = useCallback(() => {
    if (isSaving) return

    setIsCreateOpen(false)
    setName('')
    setDescription('')
    setNameError('')
    setApiError('')

    window.setTimeout(() => createButtonRef.current?.focus(), 0)
  }, [isSaving])

  // Load workflows saved in the backend.
  useEffect(() => {
    if (!tenantApiKey?.trim()) return

    let cancelled = false

    async function loadWorkflows() {
      try {
        const result = await getWorkflows(tenantApiKey!)

        if (cancelled) return

        const savedWorkflows: Workflow[] = result.workflows.map(
          (item, index) => ({
            id: String(
              item.id ?? item._id ?? `saved-${index}`,
            ),
            name: item.name ?? 'Untitled workflow',
            description:
              item.description ?? 'No description provided.',
            status:
              item.status === 'Active' ||
              item.status === 'Paused' ||
              item.status === 'Draft'
                ? item.status
                : 'Draft',
            version: item.version ?? 1,
            updatedAt: item.updatedAt
              ? String(item.updatedAt).slice(0, 10)
              : new Date().toISOString().slice(0, 10),
          }),
        )

        setWorkflows((current) => {
          const merged = [...current]

          for (const saved of savedWorkflows) {
            const exists = merged.some(
              (workflow) =>
                workflow.name.toLowerCase() ===
                saved.name.toLowerCase(),
            )

            if (!exists) {
              merged.push(saved)
            }
          }

          return merged
        })
      } catch (error) {
        console.error('Unable to load saved workflows:', error)
        if (!cancelled) {
          setWorkflowLoadError(
            error instanceof Error
              ? error.message
              : 'Saved workflows could not be loaded. Please try again.',
          )
        }
      } finally {
        if (!cancelled) setIsLoadingSavedWorkflows(false)
      }
    }

    void loadWorkflows()

    return () => {
      cancelled = true
    }
  }, [tenantApiKey, workflowReloadKey])

  // Manage keyboard focus inside the create-workflow dialog.
  useEffect(() => {
    if (!isCreateOpen) return

    nameInputRef.current?.focus()

    function handleModalKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeCreateModal()
        return
      }

      if (event.key !== 'Tab' || !modalRef.current) return

      const focusableElements =
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )

      if (focusableElements.length === 0) return

      const firstElement = focusableElements[0]
      const lastElement =
        focusableElements[focusableElements.length - 1]

      if (
        event.shiftKey &&
        document.activeElement === firstElement
      ) {
        event.preventDefault()
        lastElement.focus()
      } else if (
        !event.shiftKey &&
        document.activeElement === lastElement
      ) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', handleModalKeyDown)

    return () => {
      document.removeEventListener(
        'keydown',
        handleModalKeyDown,
      )
    }
  }, [isCreateOpen, closeCreateModal])

  const filteredWorkflows = workflows.filter((workflow) => {
    const query = search.trim().toLowerCase()

    const matchesSearch =
      workflow.name.toLowerCase().includes(query) ||
      workflow.description.toLowerCase().includes(query)

    const matchesStatus =
      statusFilter === 'All' ||
      workflow.status === statusFilter

    return matchesSearch && matchesStatus
  })

  async function handleCreateWorkflow(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    if (isSaving) return

    const trimmedName = name.trim()
    const trimmedDescription = description.trim()

    setNameError('')
    setApiError('')

    if (!trimmedName) {
      setNameError('Please enter a workflow name.')
      return
    }

    const duplicate = workflows.some(
      (workflow) =>
        workflow.name.toLowerCase() ===
        trimmedName.toLowerCase(),
    )

    if (duplicate) {
      setNameError(
        'A workflow with this name already exists.',
      )
      return
    }

    if (!graph) {
      setApiError(
        'No workflow graph is available. Open Node Preview and prepare a graph before saving.',
      )
      return
    }

    if (!tenantApiKey?.trim()) {
      setApiError(
        'API authentication is not configured. Ask your team for the approved development API-key setup.',
      )
      return
    }

    setIsSaving(true)

    try {
      const result = await createWorkflow(
        {
          name: trimmedName,
          ...(trimmedDescription
            ? { description: trimmedDescription }
            : {}),
          graph,
        },
        tenantApiKey,
      )

      const savedWorkflow = result?.workflow

      if (!savedWorkflow) {
        throw new Error(
          'The backend response did not contain a saved workflow. Please verify the API response.',
        )
      }

      const newWorkflow: Workflow = {
        id: String(
          savedWorkflow.id ??
            savedWorkflow._id ??
            `created-${Date.now()}`,
        ),
        name: savedWorkflow.name ?? trimmedName,
        description:
          savedWorkflow.description ??
          trimmedDescription ??
          'No description provided.',
        status:
          savedWorkflow.status === 'Active' ||
          savedWorkflow.status === 'Paused' ||
          savedWorkflow.status === 'Draft'
            ? savedWorkflow.status
            : 'Draft',
        version: savedWorkflow.version ?? 1,
        updatedAt: savedWorkflow.updatedAt
          ? String(savedWorkflow.updatedAt).slice(0, 10)
          : new Date().toISOString().slice(0, 10),
      }

      setWorkflows((current) => {
        const alreadyExists = current.some(
          (workflow) =>
            workflow.name.toLowerCase() ===
            newWorkflow.name.toLowerCase(),
        )

        if (alreadyExists) return current

        return [...current, newWorkflow]
      })

      setSearch('')
      setStatusFilter('All')
      setIsCreateOpen(false)
      setName('')
      setDescription('')
      setNameError('')
      setApiError('')

      window.setTimeout(
        () => createButtonRef.current?.focus(),
        0,
      )
    } catch (error) {
      setApiError(
        error instanceof Error
          ? error.message
          : 'Unable to save the workflow. Please try again.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="workflows-page">
      <header className="workflows-page__header">
        <div>
          <p className="workflows-page__eyebrow">
            WORKFLOW MANAGEMENT
          </p>
          <h1>Workflows</h1>
          <p>
            Build, search, and manage your workflow definitions.
          </p>
        </div>

        <button
          ref={createButtonRef}
          type="button"
          className="workflows-page__create"
          onClick={() => {
            setApiError('')
            setIsCreateOpen(true)
          }}
        >
          <span aria-hidden="true">+</span> Create workflow
        </button>
      </header>

      <p className="workflows-page__demo-note">
        Sample workflows are displayed for demonstration.
        Workflows created through the form are added after the
        backend confirms a successful save. Saved workflows are
        loaded from the backend when authentication is configured.
      </p>

      {isLoadingSavedWorkflows && (
        <p className="workflows-page__load-status" role="status" aria-live="polite">
          Loading saved workflows...
        </p>
      )}

      {workflowLoadError && (
        <div className="workflows-page__load-error" role="alert">
          <p>Saved workflows could not be refreshed: {workflowLoadError}</p>
          <button
            type="button"
            className="workflows-page__secondary"
            onClick={() => {
              setWorkflowLoadError('')
              setIsLoadingSavedWorkflows(true)
              setWorkflowReloadKey((current) => current + 1)
            }}
            disabled={isLoadingSavedWorkflows}
          >
            Try again
          </button>
        </div>
      )}

      <p className="workflows-page__note" role="status">
        {graph
          ? `Workflow graph available (${graph.nodes.length} nodes, ${graph.edges.length} edges).`
          : 'Open Node Preview to prepare a workflow graph.'}
      </p>

      <div className="workflows-page__filters">
        <div className="workflows-page__search-field">
          <label htmlFor="workflow-search">
            Search workflows
          </label>
          <input
            id="workflow-search"
            type="search"
            placeholder="Search by name or description..."
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
          />
        </div>

        <div className="workflows-page__status-field">
          <label htmlFor="workflow-status">
            Filter by status
          </label>
          <select
            id="workflow-status"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value)
            }
          >
            <option>All</option>
            <option>Active</option>
            <option>Draft</option>
            <option>Paused</option>
          </select>
        </div>
      </div>

      <div className="workflows-page__results-heading">
        <h2>All workflows</h2>
        <span>{filteredWorkflows.length} shown</span>
      </div>

      {workflows.length === 0 ? (
        <WorkflowListState
          loading={isLoadingSavedWorkflows}
          hasWorkflows={false}
        />
      ) : filteredWorkflows.length === 0 ? (
        <div className="workflows-page__empty" role="status">
          <h2>No matching workflows</h2>
          <p>
            Try another search term or change the status filter.
          </p>
          <button
            type="button"
            className="workflows-page__secondary"
            onClick={() => {
              setSearch('')
              setStatusFilter('All')
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="workflows-page__list">
          {filteredWorkflows.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              name={workflow.name}
              description={workflow.description}
              status={workflow.status}
              version={workflow.version}
              updatedAt={workflow.updatedAt}
            />
          ))}
        </div>
      )}

      {isCreateOpen && (
        <div
          className="workflows-page__modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !isSaving
            ) {
              closeCreateModal()
            }
          }}
        >
          <section
            ref={modalRef}
            className="workflows-page__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workflow-modal-title"
          >
            <header className="workflows-page__modal-header">
              <div>
                <p className="workflows-page__eyebrow">
                  NEW DEFINITION
                </p>
                <h2 id="workflow-modal-title">
                  Create workflow
                </h2>
                <p>
                  Give your workflow a name and an optional
                  description.
                </p>
              </div>

              <button
                type="button"
                className="workflows-page__close"
                aria-label="Close create workflow dialog"
                onClick={closeCreateModal}
                disabled={isSaving}
              >
                ×
              </button>
            </header>

            <form
              className="workflows-page__form"
              onSubmit={handleCreateWorkflow}
              noValidate
            >
              <div className="workflows-page__form-field">
                <label htmlFor="workflow-name">
                  Workflow name *
                </label>
                <input
                  ref={nameInputRef}
                  id="workflow-name"
                  name="name"
                  type="text"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value)
                    if (nameError) setNameError('')
                    if (apiError) setApiError('')
                  }}
                  maxLength={100}
                  placeholder="e.g. Payment Processing"
                  aria-invalid={Boolean(nameError)}
                  aria-describedby={
                    nameError
                      ? 'workflow-name-error'
                      : undefined
                  }
                  autoFocus
                  disabled={isSaving}
                />

                {nameError && (
                  <p
                    id="workflow-name-error"
                    className="workflows-page__error"
                    role="alert"
                  >
                    {nameError}
                  </p>
                )}
              </div>

              <div className="workflows-page__form-field">
                <label htmlFor="workflow-description">
                  Description <span>(optional)</span>
                </label>
                <textarea
                  id="workflow-description"
                  name="description"
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value)
                    if (apiError) setApiError('')
                  }}
                  rows={4}
                  maxLength={500}
                  placeholder="Describe what this workflow does..."
                  disabled={isSaving}
                />

                <span className="workflows-page__character-count">
                  {description.length}/500
                </span>
              </div>

              {apiError && (
                <p
                  className="workflows-page__error"
                  role="alert"
                >
                  {apiError}
                </p>
              )}

              <div className="workflows-page__modal-actions">
                <button
                  type="button"
                  className="workflows-page__secondary"
                  onClick={closeCreateModal}
                  disabled={isSaving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="workflows-page__create"
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save workflow'}
                </button>
              </div>

              <p className="workflows-page__note">
                New workflows start in Draft status. Saving
                requires a valid graph and approved API
                authentication.
              </p>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}

export default WorkflowsPage
