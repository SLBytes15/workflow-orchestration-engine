
import { useState } from 'react'
import WorkflowsPage from './pages/WorkflowsPage'
import ExecutionsPage from './pages/ExecutionsPage'
import Sidebar from './components/layout/Sidebar'
import NodePreview from './components/workflow/nodes/NodePreview'
import {
  updateWorkflow,
  type WorkflowGraph,
} from './api/workflowApi'
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

  const handleSaveGraph = async (graph: WorkflowGraph) => {
    if (!workflowId) {
      setSaveError('No saved workflow selected.')
      return
    }

    if (!tenantApiKey?.trim()) {
      setSaveError('API authentication is not configured.')
      return
    }

    setIsSaving(true)
    setSaveError('')
    setSaveMessage('')

    try {
      await updateWorkflow(
        workflowId,
        { graph },
        tenantApiKey,
      )

      setWorkflowGraph(graph)
      setSaveMessage('Workflow changes saved successfully.')
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Unable to save workflow changes.',
      )
    } finally {
      setIsSaving(false)
    }
  }

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
          <>
            <h1>Dashboard</h1>
            <p>Welcome to the Workflow App.</p>
            <WorkflowsPage
              graph={workflowGraph}
              tenantApiKey={tenantApiKey}
              onEditWorkflow={handleEditWorkflow}
            />
          </>
        )}

        {activePage === 'Workflows' && (
          <WorkflowsPage
            graph={workflowGraph}
            tenantApiKey={tenantApiKey}
            onEditWorkflow={handleEditWorkflow}
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
          <section>
            <h1>Settings</h1>
            <p>Manage your workflow application preferences.</p>

            <div className="workflow-card">
              <h3>General Settings</h3>
              <p>Application: Workflow App</p>
              <p>Environment: Development</p>
            </div>

            <div className="workflow-card">
              <h3>Notifications</h3>
              <p>
                Notification preferences are not available yet.
              </p>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
