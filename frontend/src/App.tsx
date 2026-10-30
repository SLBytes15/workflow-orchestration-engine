
import { useState, useCallback } from 'react'
import DashboardPage from './pages/DashboardPage'
import WorkflowsPage from './pages/WorkflowsPage'
import ExecutionsPage from './pages/ExecutionsPage'
import SettingsPage from './pages/SettingsPage'
import Sidebar from './components/layout/Sidebar'
import NodePreview from './components/workflow/nodes/NodePreview'
import {
  activateWorkflow,
  createWorkflow,
  pauseWorkflow,
  resumeWorkflow,
  updateWorkflow,
  type WorkflowGraph,
} from './api/workflowApi'
import {
  appendWorkflow,
  initialWorkflows,
  mapPersistedWorkflow,
  type Workflow,
} from './workflowState'
import { validateWorkflowGraph } from './graphValidation'
import './App.css'

type Page =
  | 'Dashboard'
  | 'Workflows'
  | 'Node Preview'
  | 'Executions'
  | 'Settings'

function App() {
  const [activePage, setActivePage] = useState<Page>('Dashboard')
  const [workflows, setWorkflows] = useState<Workflow[]>(initialWorkflows)
  const [createWorkflowRequested, setCreateWorkflowRequested] = useState(false)
  const [workflowGraph, setWorkflowGraph] =
    useState<WorkflowGraph | null>(null)
  const [workflowId, setWorkflowId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [isStatusActionPending, setIsStatusActionPending] = useState(false)
  const [statusActionError, setStatusActionError] = useState('')
  const [statusActionMessage, setStatusActionMessage] = useState('')

  const tenantApiKey = import.meta.env.VITE_API_KEY

  console.log('API key configured:', Boolean(tenantApiKey?.trim()))

  const handleEditWorkflow = useCallback(
    (id: string, graph: WorkflowGraph) => {
      setWorkflowId(id)
      setWorkflowGraph(graph)
      setSaveError('')
      setSaveMessage('')
      setStatusActionError('')
      setStatusActionMessage('')
      setActivePage('Node Preview')
    },
    [],
  )

  const handleWorkflowsChange = useCallback((nextWorkflows: Workflow[]) => {
    setWorkflows(nextWorkflows)
    setWorkflowId((currentId) => {
      if (
        currentId &&
        !nextWorkflows.some((w) => String(w.id) === String(currentId))
      ) {
        setWorkflowGraph(null)
        return null
      }
      return currentId
    })
  }, [])

  const handleActivateWorkflow = async () => {
    if (!workflowId || !tenantApiKey?.trim()) return
    setIsStatusActionPending(true)
    setStatusActionError('')
    setStatusActionMessage('')

    try {
      const response = await activateWorkflow(workflowId, tenantApiKey)
      const mapped = mapPersistedWorkflow(response.workflow, {
        name: currentWorkflow?.name,
        description: currentWorkflow?.description,
      })
      setWorkflows((current) =>
        current.map((w) => (String(w.id) === String(workflowId) ? mapped : w)),
      )
      setStatusActionMessage(`Workflow "${mapped.name}" is now Active.`)
    } catch (error) {
      setStatusActionError(
        error instanceof Error ? error.message : 'Failed to activate workflow.',
      )
    } finally {
      setIsStatusActionPending(false)
    }
  }

  const handlePauseWorkflow = async () => {
    if (!workflowId || !tenantApiKey?.trim()) return
    setIsStatusActionPending(true)
    setStatusActionError('')
    setStatusActionMessage('')

    try {
      const response = await pauseWorkflow(workflowId, tenantApiKey)
      const mapped = mapPersistedWorkflow(response.workflow, {
        name: currentWorkflow?.name,
        description: currentWorkflow?.description,
      })
      setWorkflows((current) =>
        current.map((w) => (String(w.id) === String(workflowId) ? mapped : w)),
      )
      setStatusActionMessage(`Workflow "${mapped.name}" has been Paused.`)
    } catch (error) {
      setStatusActionError(
        error instanceof Error ? error.message : 'Failed to pause workflow.',
      )
    } finally {
      setIsStatusActionPending(false)
    }
  }

  const handleResumeWorkflow = async () => {
    if (!workflowId || !tenantApiKey?.trim()) return
    setIsStatusActionPending(true)
    setStatusActionError('')
    setStatusActionMessage('')

    try {
      const response = await resumeWorkflow(workflowId, tenantApiKey)
      const mapped = mapPersistedWorkflow(response.workflow, {
        name: currentWorkflow?.name,
        description: currentWorkflow?.description,
      })
      setWorkflows((current) =>
        current.map((w) => (String(w.id) === String(workflowId) ? mapped : w)),
      )
      setStatusActionMessage(`Workflow "${mapped.name}" is now Active.`)
    } catch (error) {
      setStatusActionError(
        error instanceof Error ? error.message : 'Failed to resume workflow.',
      )
    } finally {
      setIsStatusActionPending(false)
    }
  }

  const handleSaveGraph = async (
    graph: WorkflowGraph,
    metadata?: { name?: string; description?: string },
  ) => {
    if (!tenantApiKey?.trim()) {
      setSaveError('API authentication is not configured.')
      return
    }

    setIsSaving(true)
    setSaveError('')
    setSaveMessage('')

    try {
      if (workflowId) {
        await updateWorkflow(
          workflowId,
          {
            graph,
            ...(metadata?.name?.trim() ? { name: metadata.name.trim() } : {}),
            ...(metadata?.description !== undefined
              ? { description: metadata.description.trim() }
              : {}),
          },
          tenantApiKey,
        )

        setWorkflowGraph(graph)
        setWorkflows((current) =>
          current.map((wf) =>
            String(wf.id) === String(workflowId)
              ? {
                  ...wf,
                  graph,
                  name: metadata?.name?.trim() || wf.name,
                  description:
                    metadata?.description !== undefined
                      ? metadata.description.trim()
                      : wf.description,
                  updatedAt: new Date().toISOString().slice(0, 10),
                }
              : wf,
          ),
        )
        setSaveMessage('Workflow changes saved successfully.')
      } else {
        const trimmedName = metadata?.name?.trim() || 'Untitled Workflow'
        const trimmedDescription = metadata?.description?.trim()

        const result = await createWorkflow(
          {
            name: trimmedName,
            ...(trimmedDescription ? { description: trimmedDescription } : {}),
            graph,
          },
          tenantApiKey,
        )

        const savedWorkflow = result?.workflow
        if (!savedWorkflow) {
          throw new Error('The backend response did not contain a saved workflow.')
        }

        const newWorkflow = mapPersistedWorkflow(savedWorkflow, {
          name: trimmedName,
          description: trimmedDescription || 'No description provided.',
        })

        const createdId = String(newWorkflow.id)
        setWorkflowId(createdId)
        setWorkflowGraph(graph)
        setWorkflows((current) => appendWorkflow(current, newWorkflow))
        setSaveMessage('Workflow created and saved successfully.')
      }
    } catch (error) {
      const rawMessage =
        error instanceof Error
          ? error.message
          : 'Unable to save workflow changes.'
      const userMessage =
        rawMessage.includes('Failed to fetch') ||
        rawMessage.includes('NetworkError') ||
        rawMessage.includes('fetch failed')
          ? 'Unable to reach the workflow backend server. Please verify the backend service is running.'
          : rawMessage
      setSaveError(userMessage)
    } finally {
      setIsSaving(false)
    }
  }

  const currentWorkflow = workflowId
    ? workflows.find((w) => String(w.id) === String(workflowId))
    : null

  const graphIssues = workflowGraph
    ? validateWorkflowGraph(workflowGraph)
    : []

  const graphStatus = !workflowGraph
    ? 'Waiting for graph'
    : graphIssues.length === 0
      ? 'Graph available'
      : `Graph available — ${graphIssues.length} contract ${
          graphIssues.length === 1 ? 'issue' : 'issues'
        }`

  return (
    <div className="app-layout">
      <Sidebar
        activePage={activePage}
        onNavigate={(page) => {
          setActivePage(page as Page)
        }}
      />

      <main className="app">
        {activePage === 'Dashboard' && (
          <DashboardPage
            workflows={workflows}
            tenantApiKey={tenantApiKey}
            onNavigate={(page) => setActivePage(page as Page)}
            onCreateWorkflow={() => {
              setCreateWorkflowRequested(true)
              setActivePage('Workflows')
            }}
            onEditWorkflow={handleEditWorkflow}
          />
        )}

        {activePage === 'Workflows' && (
          <WorkflowsPage
            graph={workflowGraph}
            tenantApiKey={tenantApiKey}
            onEditWorkflow={handleEditWorkflow}
            workflows={workflows}
            onWorkflowsChange={handleWorkflowsChange}
            initialCreateOpen={createWorkflowRequested}
            onClearInitialCreateOpen={() => setCreateWorkflowRequested(false)}
          />
        )}

        {activePage === 'Node Preview' && (
          <>
            <h1>Node Preview</h1>
            <p
              role="status"
              className="node-preview__status"
            >
              Graph status: {graphStatus}
            </p>

            <NodePreview
              workflowId={workflowId ?? undefined}
              workflowName={currentWorkflow?.name}
              workflowDescription={currentWorkflow?.description}
              workflowStatus={currentWorkflow?.status}
              initialGraph={workflowGraph ?? currentWorkflow?.graph ?? null}
              onGraphChange={setWorkflowGraph}
              onSaveGraph={handleSaveGraph}
              isSaving={isSaving}
              saveError={saveError}
              saveMessage={saveMessage}
              onActivateWorkflow={handleActivateWorkflow}
              onPauseWorkflow={handlePauseWorkflow}
              onResumeWorkflow={handleResumeWorkflow}
              isStatusActionPending={isStatusActionPending}
              statusActionError={statusActionError}
              statusActionMessage={statusActionMessage}
            />
          </>
        )}

        {activePage === 'Executions' && (
          <ExecutionsPage tenantApiKey={tenantApiKey} />
        )}

        {activePage === 'Settings' && (
          <SettingsPage tenantApiKey={tenantApiKey} />
        )}
      </main>
    </div>
  )
}

export default App
