import './WorkflowListState.css'
type WorkflowListStateProps = {
  loading: boolean
  hasWorkflows: boolean
}

function WorkflowListState({
  loading,
  hasWorkflows,
}: WorkflowListStateProps) {
  if (loading) {
    return (
      <div className="workflow-list-state" role="status" aria-live="polite">
        Loading workflows...
      </div>
    )
  }

  if (!hasWorkflows) {
    return (
      <div className="workflow-list-state" role="status">
        No workflows yet
      </div>
    )
  }

  return null
}

export default WorkflowListState