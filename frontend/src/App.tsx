import WorkflowsPage from './pages/WorkflowsPage'
import Sidebar from './components/layout/Sidebar'
import NodePreview from './components/workflow/nodes/NodePreview'
import './App.css'

function App() {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="app">
        <WorkflowsPage />
        <NodePreview />
      </main>
    </div>
  )
}

export default App