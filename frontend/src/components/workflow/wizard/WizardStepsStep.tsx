import {
  CONDITION_OPERATOR_LABELS,
  type ConditionOp,
  parseConditionValue,
} from "../nodes/node.types";
import {
  createDefaultCondition,
  createDefaultTask,
  type TaskAction,
  type WizardCondition,
  type WizardState,
  type WizardStep,
  type WizardTask,
} from "./wizardState";

interface WizardStepsStepProps {
  state: WizardState;
  onChange: (updates: { steps: WizardStep[] }) => void;
  errors: Array<{ message: string }>;
}

export function WizardStepsStep({
  state,
  onChange,
  errors,
}: WizardStepsStepProps) {
  const steps = state.steps;

  function updateStep(index: number, updated: WizardStep) {
    const nextSteps = [...steps];
    nextSteps[index] = updated;
    onChange({ steps: nextSteps });
  }

  function removeStep(index: number) {
    if (steps.length <= 1) return;
    const nextSteps = steps.filter((_, i) => i !== index);
    onChange({ steps: nextSteps });
  }

  function getExistingNodeIds(): Set<string> {
    const ids = new Set<string>();
    for (const s of steps) {
      ids.add(s.id);
      if (s.type === "condition") {
        if (s.trueTarget?.id) ids.add(s.trueTarget.id);
        if (s.falseTarget?.id) ids.add(s.falseTarget.id);
      }
    }
    return ids;
  }

  function addActionStep() {
    const existing = getExistingNodeIds();
    let index = steps.length + 1;
    while (existing.has(`task-${index}`)) {
      index++;
    }
    const nextId = `task-${index}`;
    const newTask = createDefaultTask(nextId, `Action step ${index}`, "http");
    onChange({ steps: [...steps, newTask] });
  }

  function addDecisionStep() {
    const existing = getExistingNodeIds();
    let index = steps.length + 1;
    while (
      existing.has(`condition-${index}`) ||
      existing.has(`task-true-${index}`) ||
      existing.has(`task-false-${index}`)
    ) {
      index++;
    }
    const nextId = `condition-${index}`;
    const trueId = `task-true-${index}`;
    const falseId = `task-false-${index}`;
    const newCondition = createDefaultCondition(nextId, `Decision step ${index}`, trueId, falseId);
    onChange({ steps: [...steps, newCondition] });
  }

  return (
    <div className="wizard-step">
      <div className="wizard-step__header">
        <h3 className="wizard-step__title">Step 3: Define Workflow Actions and Decisions</h3>
        <p className="wizard-step__description">
          Add the actions to perform and decisions to branch on. The wizard automatically connects the steps in the correct order.
        </p>
      </div>

      {errors.length > 0 && (
        <div className="wizard-alert wizard-alert--warning" role="alert">
          <ul className="wizard-alert__list">
            {errors.map((e) => (
              <li key={e.message}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="wizard-step-list">
        {steps.map((step, index) => (
          <div key={step.id} className="wizard-step-card">
            <div className="wizard-step-card__header">
              <span className="wizard-step-card__number">Step {index + 1}</span>
              <span className={`wizard-badge wizard-badge--${step.type}`}>
                {step.type === "condition" ? "Decision (Branch)" : "Action"}
              </span>
              <div className="wizard-step-card__actions">
                {steps.length > 1 && (
                  <button
                    type="button"
                    className="wizard-button wizard-button--danger-text"
                    onClick={() => removeStep(index)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            <div className="wizard-form-group">
              <label htmlFor={`step-name-${step.id}`} className="wizard-label">Step Name / Title</label>
              <input
                id={`step-name-${step.id}`}
                type="text"
                className="wizard-input"
                value={step.label}
                maxLength={120}
                onChange={(e) => updateStep(index, { ...step, label: e.target.value })}
              />
            </div>

            {step.type === "task" ? (
              <TaskConfigForm
                task={step}
                onChange={(updated) => updateStep(index, updated)}
              />
            ) : (
              <ConditionConfigForm
                condition={step}
                onChange={(updated) => updateStep(index, updated)}
              />
            )}
          </div>
        ))}
      </div>

      <div className="wizard-add-controls">
        <button
          type="button"
          className="wizard-button wizard-button--outline"
          onClick={addActionStep}
        >
          + Add Action (Task)
        </button>
        <button
          type="button"
          className="wizard-button wizard-button--outline"
          onClick={addDecisionStep}
        >
          + Add Decision (Condition)
        </button>
      </div>
    </div>
  );
}

function TaskConfigForm({
  task,
  onChange,
}: {
  task: WizardTask;
  onChange: (updated: WizardTask) => void;
}) {
  return (
    <div className="wizard-task-form">
      <div className="wizard-form-group">
        <label htmlFor={`action-type-${task.id}`} className="wizard-label">Action Type</label>
        <select
          id={`action-type-${task.id}`}
          className="wizard-select"
          value={task.action}
          onChange={(e) => onChange({ ...task, action: e.target.value as TaskAction })}
        >
          <option value="http">HTTP Request (Webhook)</option>
          <option value="sendEmail">Send Email</option>
          <option value="sendSlack">Send Slack Message</option>
          <option value="dbQuery">Database Query</option>
          <option value="transform">Transform Data</option>
        </select>
      </div>

      {task.action === "http" && (
        <div className="wizard-grid-2">
          <div className="wizard-form-group">
            <label htmlFor={`http-method-${task.id}`} className="wizard-label">Method</label>
            <select
              id={`http-method-${task.id}`}
              className="wizard-select"
              value={task.httpMethod}
              onChange={(e) =>
                onChange({
                  ...task,
                  httpMethod: e.target.value as WizardTask["httpMethod"],
                })
              }
            >
              <option value="POST">POST</option>
              <option value="GET">GET</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
              <option value="PATCH">PATCH</option>
            </select>
          </div>
          <div className="wizard-form-group">
            <label htmlFor={`http-url-${task.id}`} className="wizard-label">Target URL</label>
            <input
              id={`http-url-${task.id}`}
              type="text"
              className="wizard-input"
              value={task.httpUrl}
              placeholder="https://api.example.com/endpoint"
              onChange={(e) => onChange({ ...task, httpUrl: e.target.value })}
            />
          </div>
        </div>
      )}

      {task.action === "sendEmail" && (
        <div className="wizard-grid-gap">
          <div className="wizard-form-group">
            <label htmlFor={`email-to-${task.id}`} className="wizard-label">Recipient Email</label>
            <input
              id={`email-to-${task.id}`}
              type="email"
              className="wizard-input"
              value={task.emailTo}
              placeholder="recipient@example.com"
              onChange={(e) => onChange({ ...task, emailTo: e.target.value })}
            />
          </div>
          <div className="wizard-form-group">
            <label htmlFor={`email-subject-${task.id}`} className="wizard-label">Subject Line</label>
            <input
              id={`email-subject-${task.id}`}
              type="text"
              className="wizard-input"
              value={task.emailSubject}
              onChange={(e) => onChange({ ...task, emailSubject: e.target.value })}
            />
          </div>
          <div className="wizard-form-group">
            <label htmlFor={`email-body-${task.id}`} className="wizard-label">Message Body</label>
            <textarea
              id={`email-body-${task.id}`}
              className="wizard-textarea"
              rows={2}
              value={task.emailBody}
              onChange={(e) => onChange({ ...task, emailBody: e.target.value })}
            />
          </div>
        </div>
      )}

      {task.action === "sendSlack" && (
        <div className="wizard-grid-2">
          <div className="wizard-form-group">
            <label htmlFor={`slack-channel-${task.id}`} className="wizard-label">Channel</label>
            <input
              id={`slack-channel-${task.id}`}
              type="text"
              className="wizard-input"
              value={task.slackChannel}
              placeholder="#alerts"
              onChange={(e) => onChange({ ...task, slackChannel: e.target.value })}
            />
          </div>
          <div className="wizard-form-group">
            <label htmlFor={`slack-message-${task.id}`} className="wizard-label">Message</label>
            <input
              id={`slack-message-${task.id}`}
              type="text"
              className="wizard-input"
              value={task.slackMessage}
              onChange={(e) => onChange({ ...task, slackMessage: e.target.value })}
            />
          </div>
        </div>
      )}

      {task.action === "dbQuery" && (
        <div className="wizard-grid-gap">
          <div className="wizard-form-group">
            <label htmlFor={`db-conn-${task.id}`} className="wizard-label">Connection Identifier</label>
            <input
              id={`db-conn-${task.id}`}
              type="text"
              className="wizard-input"
              value={task.dbConnection}
              onChange={(e) => onChange({ ...task, dbConnection: e.target.value })}
            />
          </div>
          <div className="wizard-form-group">
            <label htmlFor={`db-query-${task.id}`} className="wizard-label">SQL Query</label>
            <input
              id={`db-query-${task.id}`}
              type="text"
              className="wizard-input"
              value={task.dbQuery}
              onChange={(e) => onChange({ ...task, dbQuery: e.target.value })}
            />
          </div>
        </div>
      )}

      {task.action === "transform" && (
        <div className="wizard-form-group">
          <label htmlFor={`transform-exp-${task.id}`} className="wizard-label">Transformation Expression</label>
          <input
            id={`transform-exp-${task.id}`}
            type="text"
            className="wizard-input"
            value={task.transformExpression}
            placeholder="input.total * 1.2"
            onChange={(e) => onChange({ ...task, transformExpression: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}

function ConditionConfigForm({
  condition,
  onChange,
}: {
  condition: WizardCondition;
  onChange: (updated: WizardCondition) => void;
}) {
  function handleValueChange(rawValue: string, valueType = condition.valueType) {
    const parsed = parseConditionValue(rawValue, valueType);
    onChange({
      ...condition,
      rawValue,
      valueType,
      right: parsed.value !== undefined ? parsed.value : rawValue,
    });
  }

  return (
    <div className="wizard-condition-form">
      <div className="wizard-condition-form__rule">
        <h5 className="wizard-condition-form__section-title">Condition Rule</h5>
        <div className="wizard-grid-3">
          <div className="wizard-form-group">
            <label htmlFor={`cond-left-${condition.id}`} className="wizard-label">What field to check?</label>
            <input
              id={`cond-left-${condition.id}`}
              type="text"
              className="wizard-input"
              placeholder="e.g. approved or order.total"
              value={condition.left}
              onChange={(e) => onChange({ ...condition, left: e.target.value })}
            />
          </div>

          <div className="wizard-form-group">
            <label htmlFor={`cond-op-${condition.id}`} className="wizard-label">Comparison</label>
            <select
              id={`cond-op-${condition.id}`}
              className="wizard-select"
              value={condition.op}
              onChange={(e) => onChange({ ...condition, op: e.target.value as ConditionOp })}
            >
              {Object.entries(CONDITION_OPERATOR_LABELS).map(([op, label]) => (
                <option key={op} value={op}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="wizard-form-group">
            <label htmlFor={`cond-val-${condition.id}`} className="wizard-label">Comparison Value</label>
            <input
              id={`cond-val-${condition.id}`}
              type="text"
              className="wizard-input"
              value={condition.rawValue}
              placeholder="e.g. true or 100"
              onChange={(e) => handleValueChange(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="wizard-condition-branches">
        <div className="wizard-branch-card wizard-branch-card--true">
          <div className="wizard-branch-card__header">
            <span className="wizard-badge wizard-badge--true">True (Yes) Outcome</span>
            <span className="wizard-branch-card__hint">Runs when the condition is met</span>
          </div>
          <div className="wizard-form-group">
            <label htmlFor={`true-target-name-${condition.id}`} className="wizard-label">Action Name</label>
            <input
              id={`true-target-name-${condition.id}`}
              type="text"
              className="wizard-input"
              value={condition.trueTarget.label}
              onChange={(e) =>
                onChange({
                  ...condition,
                  trueTarget: { ...condition.trueTarget, label: e.target.value },
                })
              }
            />
          </div>
          <TaskConfigForm
            task={condition.trueTarget}
            onChange={(updated) => onChange({ ...condition, trueTarget: updated })}
          />
        </div>

        <div className="wizard-branch-card wizard-branch-card--false">
          <div className="wizard-branch-card__header">
            <span className="wizard-badge wizard-badge--false">False (No) Outcome</span>
            <span className="wizard-branch-card__hint">Runs when the condition is not met</span>
          </div>
          <div className="wizard-form-group">
            <label htmlFor={`false-target-name-${condition.id}`} className="wizard-label">Action Name</label>
            <input
              id={`false-target-name-${condition.id}`}
              type="text"
              className="wizard-input"
              value={condition.falseTarget.label}
              onChange={(e) =>
                onChange({
                  ...condition,
                  falseTarget: { ...condition.falseTarget, label: e.target.value },
                })
              }
            />
          </div>
          <TaskConfigForm
            task={condition.falseTarget}
            onChange={(updated) => onChange({ ...condition, falseTarget: updated })}
          />
        </div>
      </div>
    </div>
  );
}

