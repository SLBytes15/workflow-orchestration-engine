
import { useState } from 'react'
import WorkflowsPage from './pages/WorkflowsPage'
import Sidebar from './components/layout/Sidebar'
import NodePreview from './components/workflow/nodes/NodePreview'
import type { WorkflowGraph } from './api/workflowApi'
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

  return (
    <div className="app-layout">
      <Sidebar
        activePage={activePage}
        onNavigate={(page) => setActivePage(page as Page)}
      />

      <main className="app">
        {activePage === 'Dashboard' && (
          <>
            <h1>Dashboard</h1>
            <p>Welcome to the Workflow App.</p>
            <WorkflowsPage graph={workflowGraph} />
          </>
        )}

        {activePage === 'Workflows' && (
          <WorkflowsPage graph={workflowGraph} />
        )}

        {activePage === 'Node Preview' && (
          <>
            <h1>Node Preview</h1>
            <NodePreview onGraphChange={setWorkflowGraph} />
            <p>
              Graph status:{' '}
              {workflowGraph ? 'Graph available' : 'Waiting for graph'}
            </p>
          </>
        )}

        {activePage === 'Executions' && (
          <section>
            <h1>Executions</h1>
            <p>Track and monitor your workflow runs.</p>

            <div className="workflow-card">
              <h3>Execution History</h3>
              <p>No executions available yet.</p>
            </div>
          </section>
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