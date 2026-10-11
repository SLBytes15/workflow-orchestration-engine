
import { useState } from 'react'
import WorkflowCard from '../components/workflows/WorkflowCard'
import WorkflowListState from '../components/workflows/WorkflowListState'
import './WorkflowsPage.css'

type Workflow = {
  id: number
  name: string
  description: string
  status: 'Active' | 'Draft' | 'Paused'
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

  const filteredWorkflows = workflows.filter((workflow) => {
    const matchesSearch =
      workflow.name.toLowerCase().includes(search.toLowerCase()) ||
      workflow.description.toLowerCase().includes(search.toLowerCase())

    const matchesStatus =
      statusFilter === 'All' || workflow.status === statusFilter

    return matchesSearch && matchesStatus
  })

  return (
    <section className="workflows-page">
      <header className="workflows-page__header">
        <div>
          <h1>Workflows</h1>
          <p>Search, manage, and create your workflows.</p>
        </div>

        <button
          type="button"
          className="workflows-page__create"
          onClick={() => {
            document.getElementById('workflow-name')?.focus()
          }}
        >
          Create workflow
        </button>
      </header>

      <div className="workflows-page__filters">
        <label htmlFor="workflow-search">Search workflows</label>
        <input
          id="workflow-search"
          type="search"
          placeholder="Search by name or description..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

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

      <WorkflowListState
        loading={false}
        hasWorkflows={filteredWorkflows.length > 0}
      />

      {filteredWorkflows.length > 0 && (
        <div className="workflows-page__list">
          {filteredWorkflows.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              name={workflow.name}
              description={`${workflow.description} Updated: ${workflow.updatedAt}`}
              status={workflow.status}
              version={workflow.version}
            />
          ))}
        </div>
      )}

      {filteredWorkflows.length === 0 && search.trim() !== '' && (
        <p className="workflows-page__message" role="status">
          No workflows match your search.
        </p>
      )}

      <form
        className="workflows-page__form"
        onSubmit={(event) => {
          event.preventDefault()
          const form = event.currentTarget
          const data = new FormData(form)
          const name = String(data.get('name') ?? '').trim()
          const description = String(data.get('description') ?? '').trim()

          if (!name) return

          setWorkflows((current) => [
            ...current,
            {
              id: Date.now(),
              name,
              description: description || 'No description provided.',
              status: 'Draft',
              version: 1,
              updatedAt: new Date().toISOString().slice(0, 10),
            },
          ])

          form.reset()
        }}
      >
        <h2>Create a workflow</h2>

        <label htmlFor="workflow-name">Workflow name (required)</label>
        <input
          id="workflow-name"
          name="name"
          type="text"
          required
          maxLength={100}
          placeholder="Enter workflow name"
        />

        <label htmlFor="workflow-description">Description (optional)</label>
        <textarea
          id="workflow-description"
          name="description"
          rows={3}
          maxLength={500}
          placeholder="What does this workflow do?"
        />

        <button type="submit">Save workflow</button>
        <p className="workflows-page__note">
          Demo only: workflows are stored in this page's state and are not saved
          to the backend.
        </p>
      </form>
    </section>
  )
}

export default WorkflowsPage
