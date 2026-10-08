import './WorkflowCard.css'

type WorkflowCardProps = {
  name: string
  description: string
  status: string
  version: number
}

function WorkflowCard({
  name,
  description,
  status,
  version,
}: WorkflowCardProps) {
  return (
    <article className="workflow-card">
      <div className="workflow-card__content">
        <h2>{name}</h2>
        <p>{description}</p>

        <div className="workflow-card__meta">
          <span>Status: {status}</span>
          <span>Version: {version}</span>
        </div>
      </div>

      <button type="button" className="workflow-card__button">
        Open
      </button>
    </article>
  )
}

export default WorkflowCard
