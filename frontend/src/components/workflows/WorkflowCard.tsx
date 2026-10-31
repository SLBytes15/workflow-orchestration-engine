import './WorkflowCard.css'
import { isRunButtonDisabled } from "../../workflowState";

type WorkflowStatus = 'Active' | 'Draft' | 'Paused'

type WorkflowCardProps = {
  name: string;
  description: string;
  status: WorkflowStatus;
  version: number;
  updatedAt?: string;
  onOpen?: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
  onRun?: () => void;
  isRunning?: boolean;
  canRun?: boolean;
  onEdit?: () => void;
  onActivate?: () => void;
  isActivating?: boolean;
  onPause?: () => void;
  isPausing?: boolean;
  onResume?: () => void;
  isResuming?: boolean;
};
function WorkflowCard({
  name,
  description,
  status,
  version,
  updatedAt,
  onOpen,
  onDelete,
  isDeleting = false,
  onRun,
  isRunning = false,
  canRun = false,
  onEdit,
  onActivate,
  isActivating = false,
  onPause,
  isPausing = false,
  onResume,
  isResuming = false,
}: WorkflowCardProps) {
  return (
    <article className="workflow-card">
      <div
        className={`workflow-card__content${onOpen ? " workflow-card__content--open" : ""}`}
        role={onOpen ? "button" : undefined}
        tabIndex={onOpen ? 0 : undefined}
        aria-label={onOpen ? `Open workflow: ${name}` : undefined}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (onOpen && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onOpen();
          }
        }}
      >
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

      {(onEdit || onActivate || onPause || onResume || onRun || onDelete) && (
        <div className="workflow-card__actions">
          {onEdit && (
            <button
              type="button"
              className="workflow-card__btn workflow-card__edit"
              onClick={onEdit}
              aria-label={`Edit workflow: ${name}`}
            >
              Edit workflow
            </button>
          )}

          {status === 'Draft' && onActivate && (
            <button
              type="button"
              className="workflow-card__btn workflow-card__activate"
              onClick={onActivate}
              disabled={isActivating}
              aria-label={`Activate workflow: ${name}`}
            >
              {isActivating ? 'Activating...' : 'Activate workflow'}
            </button>
          )}

          {status === 'Active' && onPause && (
            <button
              type="button"
              className="workflow-card__btn workflow-card__pause"
              onClick={onPause}
              disabled={isPausing}
              aria-label={`Pause workflow: ${name}`}
            >
              {isPausing ? 'Pausing...' : 'Pause workflow'}
            </button>
          )}

          {status === 'Paused' && onResume && (
            <button
              type="button"
              className="workflow-card__btn workflow-card__resume"
              onClick={onResume}
              disabled={isResuming}
              aria-label={`Resume workflow: ${name}`}
            >
              {isResuming ? 'Resuming...' : 'Resume workflow'}
            </button>
          )}

          {onRun && (
            <button
              type="button"
              className="workflow-card__btn workflow-card__run"
              onClick={onRun}
              disabled={isRunButtonDisabled(canRun, isRunning)}
              aria-label={`Run workflow: ${name}`}
            >
              {isRunning ? "Running..." : "Run workflow"}
            </button>
          )}

          {onDelete && (
            <button
              type="button"
              className="workflow-card__btn workflow-card__delete"
              onClick={onDelete}
              disabled={isDeleting}
              aria-label={`Delete workflow: ${name}`}
            >
              {isDeleting ? "Deleting..." : "Delete workflow"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export default WorkflowCard