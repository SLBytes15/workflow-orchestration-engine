
import { useState } from 'react'
import DashboardPage from './pages/DashboardPage'
import WorkflowsPage from './pages/WorkflowsPage'
import ExecutionsPage from './pages/ExecutionsPage'
import SettingsPage from './pages/SettingsPage'
import Sidebar from './components/layout/Sidebar'
import NodePreview from './components/workflow/nodes/NodePreview'
import {
  createWorkflow,
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

  const tenantApiKey = import.meta.env.VITE_API_KEY

  console.log('API key configured:', Boolean(tenantApiKey?.trim()))

  const handleEditWorkflow = (
    id: string,
    graph: WorkflowGraph,
  ) => {
    setWorkflowId(id)
    setWorkflowGraph(graph)
    setSaveError('')
    setSaveMessage('')
    setActivePage('Node Preview')
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
            onWorkflowsChange={setWorkflows}
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
              initialGraph={workflowGraph}
              onGraphChange={setWorkflowGraph}
              onSaveGraph={handleSaveGraph}
              isSaving={isSaving}
              saveError={saveError}
              saveMessage={saveMessage}
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
