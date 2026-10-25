import './WorkflowCard.css'

type WorkflowStatus = 'Active' | 'Draft' | 'Paused'

type WorkflowCardProps = {
  name: string;
  description: string;
  status: WorkflowStatus;
  version: number;
  updatedAt?: string;
  onRun?: () => void;
  isRunning?: boolean;
  canRun?: boolean;
  onEdit?: () => void;
};
function WorkflowCard({
  name,
  description,
  status,
  version,
  updatedAt,
  onRun,
  isRunning = false,
  canRun = false,
  onEdit,
}: WorkflowCardProps) {
  return (
    <article className="workflow-card">
      <div className="workflow-card__content">
        <div className="workflow-card__heading">
          <h2>{name}</h2>

          <span
            className={`workflow-card__badge workflow-card__badge--${status.toLowerCase()}`}
          >
            {status}
          </span>
        </div>

        <p className="workflow-card__description">{description}</p>

        <div className="workflow-card__meta">
          <span>Version {version}</span>
          {updatedAt && <span>Updated {updatedAt}</span>}
        </div>
      </div>

      {(onRun || onEdit) && (
        <div className="workflow-card__actions">
          {onEdit && (
            <button
              type="button"
              className="workflow-card__run"
              onClick={onEdit}
            >
              Edit workflow
            </button>
          )}
          <button
            type="button"
            className="workflow-card__run"
            onClick={onRun}
            disabled={!canRun || isRunning}
            aria-label={`Run workflow: ${name}`}
          >
            {isRunning ? "Running..." : "Run workflow"}
          </button>
        </div>
      )}
    </article>
  );
}

export default WorkflowCard