import WorkflowCard from './components/workflows/WorkflowCard'
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
    </main>
  )
}

export default App
