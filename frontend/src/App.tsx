

import WorkflowCard from './components/workflows/WorkflowCard'
import NodePreview from './components/workflow/nodes/NodePreview'
import './App.css'

function App() {
  return (
    <main className="app">
      <h1>Workflows</h1>

      <WorkflowCard
        name="Payment Processing"
        description="Handles payment-related workflow operations."
        status="Active"
        version={1}
      />

      <WorkflowCard
        name="Order Management"
        description="Manages order creation, tracking, and completion."
        status="Pending"
        version={2}
      />

      <NodePreview />
    </main>
  )
}

export default App