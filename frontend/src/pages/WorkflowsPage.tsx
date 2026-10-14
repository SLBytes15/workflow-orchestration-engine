import { useEffect, useRef, useState, type FormEvent } from 'react'
import WorkflowCard from '../components/workflows/WorkflowCard'
import WorkflowListState from '../components/workflows/WorkflowListState'
import './WorkflowsPage.css'

type WorkflowStatus = 'Active' | 'Draft' | 'Paused'

type Workflow = {
  id: number
  name: string
  description: string
  status: WorkflowStatus
  version: number
  updatedAt: string
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

function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>(initialWorkflows)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [nameError, setNameError] = useState('')
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const modalRef = useRef<HTMLElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const filteredWorkflows = workflows.filter((workflow) => {
    const query = search.trim().toLowerCase()
    const matchesSearch =
      workflow.name.toLowerCase().includes(query) ||
      workflow.description.toLowerCase().includes(query)
    const matchesStatus =
      statusFilter === 'All' || workflow.status === statusFilter

    return matchesSearch && matchesStatus
  })

  function closeCreateModal() {
  setIsCreateOpen(false)
  setName('')
  setDescription('')
  setNameError('')
  window.setTimeout(() => createButtonRef.current?.focus(), 0)
}
  useEffect(() => {
  if (!isCreateOpen) return

  nameInputRef.current?.focus()

  function handleModalKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closeCreateModal()
      return
    }

    if (event.key !== 'Tab' || !modalRef.current) return

    const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )

    if (focusableElements.length === 0) return

    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]

    if (event.shiftKey && document.activeElement === firstElement) {
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
    document.removeEventListener('keydown', handleModalKeyDown)
  }
}, [isCreateOpen])

  function handleCreateWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = name.trim()

    if (!trimmedName) {
      setNameError('Please enter a workflow name.')
      return
    }

    const duplicate = workflows.some(
      (workflow) =>
        workflow.name.toLowerCase() === trimmedName.toLowerCase(),
    )

    if (duplicate) {
      setNameError('A workflow with this name already exists.')
      return
    }

    const newWorkflow: Workflow = {
      id: Date.now(),
      name: trimmedName,
      description: description.trim() || 'No description provided.',
      status: 'Draft',
      version: 1,
      updatedAt: new Date().toISOString().slice(0, 10),
    }

    setWorkflows((current) => [...current, newWorkflow])
    setSearch('')
    setStatusFilter('All')
    closeCreateModal()
  }

  return (
    <section className="workflows-page">
      <header className="workflows-page__header">
        <div>
          <p className="workflows-page__eyebrow">WORKFLOW MANAGEMENT</p>
          <h1>Workflows</h1>
          <p>Build, search, and manage your workflow definitions.</p>
        </div>

        <button
	  ref={createButtonRef}
          type="button"
          className="workflows-page__create"
          onClick={() => setIsCreateOpen(true)}
        >
          <span aria-hidden="true">+</span> Create workflow
        </button>
      </header>

      <p className="workflows-page__demo-note">
        Demo mode: sample workflows are shown, and newly created workflows are
        kept in page memory only. They are not saved to the backend.
      </p>

      <div className="workflows-page__filters">
        <div className="workflows-page__search-field">
          <label htmlFor="workflow-search">Search workflows</label>
          <input
            id="workflow-search"
            type="search"
            placeholder="Search by name or description..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="workflows-page__status-field">
          <label htmlFor="workflow-status">Filter by status</label>
          <select
            id="workflow-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
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
        <WorkflowListState loading={false} hasWorkflows={false} />
      ) : filteredWorkflows.length === 0 ? (
        <div className="workflows-page__empty" role="status">
          <h2>No matching workflows</h2>
          <p>Try another search term or change the status filter.</p>
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
            if (event.target === event.currentTarget) closeCreateModal()
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
                <p className="workflows-page__eyebrow">NEW DEFINITION</p>
                <h2 id="workflow-modal-title">Create workflow</h2>
                <p>Give your workflow a name and an optional description.</p>
              </div>
              <button
                type="button"
                className="workflows-page__close"
                aria-label="Close create workflow dialog"
                onClick={closeCreateModal}
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
                <label htmlFor="workflow-name">Workflow name *</label>
                <input
                  ref={nameInputRef}
                  id="workflow-name"
                  name="name"
                  type="text"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value)
                    if (nameError) setNameError('')
                  }}
                  maxLength={100}
                  placeholder="e.g. Payment Processing"
                  aria-invalid={Boolean(nameError)}
                  aria-describedby={nameError ? 'workflow-name-error' : undefined}
                  autoFocus
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
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                  maxLength={500}
                  placeholder="Describe what this workflow does..."
                />
                <span className="workflows-page__character-count">
                  {description.length}/500
                </span>
              </div>

              <div className="workflows-page__modal-actions">
                <button
                  type="button"
                  className="workflows-page__secondary"
                  onClick={closeCreateModal}
                >
                  Cancel
                </button>
                <button type="submit" className="workflows-page__create">
                  Save workflow
                </button>
              </div>

              <p className="workflows-page__note">
                New workflows start in Draft status. This demo does not persist
                them to the backend.
              </p>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}

export default WorkflowsPage