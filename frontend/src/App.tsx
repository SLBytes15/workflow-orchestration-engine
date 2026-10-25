
import { useCallback, useState } from 'react'
import WorkflowsPage from './pages/WorkflowsPage'
import ExecutionsPage from './pages/ExecutionsPage'
import Sidebar from './components/layout/Sidebar'
import NodePreview from './components/workflow/nodes/NodePreview'
import { updateWorkflow, type WorkflowGraph } from './api/workflowApi'
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
  const [selectedWorkflowId, setSelectedWorkflowId] =
    useState<string | null>(null)
  const [isSavingGraph, setIsSavingGraph] = useState(false)
  const [graphSaveError, setGraphSaveError] = useState('')
  const [graphSaveMessage, setGraphSaveMessage] = useState('')

  const tenantApiKey = import.meta.env.VITE_API_KEY
  console.log("API key configured:", Boolean(tenantApiKey?.trim()));

  const handleEditWorkflow = (
    workflowId: string,
    graph: WorkflowGraph,
  ) => {
    setSelectedWorkflowId(workflowId)
    setWorkflowGraph(graph)
    setGraphSaveError('')
    setGraphSaveMessage('')
    setActivePage('Node Preview')
  }

  const handleSaveGraph = async (graph: WorkflowGraph) => {
    if (!selectedWorkflowId || !tenantApiKey?.trim()) {
      setGraphSaveError('A saved workflow and API key are required.')
      setGraphSaveMessage('')
      return
    }

    setIsSavingGraph(true)
    setGraphSaveError('')
    setGraphSaveMessage('')

    try {
      await updateWorkflow(selectedWorkflowId, { graph }, tenantApiKey)
      setWorkflowGraph(graph)
      setGraphSaveMessage('Workflow changes saved successfully.')
    } catch (error) {
      setGraphSaveError(
        error instanceof Error ? error.message : 'Unable to save workflow changes.',
      )
    } finally {
      setIsSavingGraph(false)
    }
  }

  return (
    <div className="app-layout">
      <Sidebar
        activePage={activePage}
        onNavigate={(page) => {
          setOpenedWorkflow(null)
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
            <NodePreview
              key={selectedWorkflowId ?? 'new-workflow'}
              initialGraph={workflowGraph}
              onGraphChange={setWorkflowGraph}
              onSaveGraph={selectedWorkflowId ? handleSaveGraph : undefined}
              isSaving={isSavingGraph}
              saveError={graphSaveError}
              saveMessage={graphSaveMessage}
            />
            <p>
              Graph status:{' '}
              {workflowGraph ? 'Graph available' : 'Waiting for graph'}
            </p>
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
              <p>Notification preferences are not available yet.</p>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
