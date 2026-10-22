
import { useCallback, useState } from 'react'
import WorkflowsPage from './pages/WorkflowsPage'
import ExecutionsPage from './pages/ExecutionsPage'
import Sidebar from './components/layout/Sidebar'
import NodePreview from './components/workflow/nodes/NodePreview'
import { updateWorkflowGraph, type WorkflowGraph } from './api/workflowApi'
import type { Workflow } from './workflowState'
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
  const [openedWorkflow, setOpenedWorkflow] = useState<Workflow | null>(null)

  const handleGraphChange = useCallback((graph: WorkflowGraph) => {
    setWorkflowGraph(graph)
    setOpenedWorkflow((current) =>
      current ? { ...current, graph } : current,
    )
  }, [])

  const handleWorkflowDeleted = useCallback((workflowId: string) => {
    if (!openedWorkflow || String(openedWorkflow.id) !== workflowId) return
    setOpenedWorkflow(null)
    setWorkflowGraph(null)
    setActivePage('Workflows')
  }, [openedWorkflow])

  const tenantApiKey = import.meta.env.VITE_API_KEY
  console.log("API key configured:", Boolean(tenantApiKey?.trim()));

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
              onOpenWorkflow={(workflow) => {
                setOpenedWorkflow(workflow)
                setActivePage('Node Preview')
              }}
              onWorkflowDeleted={handleWorkflowDeleted}
            />
          </>
        )}

        {activePage === 'Workflows' && (
          <WorkflowsPage
            graph={workflowGraph}
            tenantApiKey={tenantApiKey}
            onOpenWorkflow={(workflow) => {
              setOpenedWorkflow(workflow)
              setActivePage('Node Preview')
            }}
            onWorkflowDeleted={handleWorkflowDeleted}
          />
        )}

        {activePage === 'Node Preview' && (
          <>
            <h1>Node Preview</h1>
            <NodePreview
              key={openedWorkflow?.id ?? 'new-workflow'}
              workflowId={
                openedWorkflow ? String(openedWorkflow.id) : undefined
              }
              workflowName={openedWorkflow?.name}
              initialGraph={openedWorkflow?.graph ?? null}
              onGraphChange={handleGraphChange}
              onSaveGraph={
                openedWorkflow && tenantApiKey
                  ? async (graph) => {
                      const result = await updateWorkflowGraph(
                        String(openedWorkflow.id),
                        graph,
                        tenantApiKey,
                      )
                      setOpenedWorkflow((current) =>
                        current && String(current.id) === String(openedWorkflow.id)
                          ? { ...current, graph: result.workflow.graph }
                          : current,
                      )
                    }
                  : undefined
              }
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
