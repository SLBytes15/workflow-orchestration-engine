import {
  buildCanonicalGraphFromWizard,
  type WizardState,
} from "./wizardState";
import { validateWorkflowGraphDetailed } from "../../../graphValidation";
import { summarizeCondition } from "../nodes/node.types";

interface WizardReviewStepProps {
  state: WizardState;
  onGoToStep: (stepIndex: number) => void;
  onSave?: (
    graphPayload: ReturnType<typeof buildCanonicalGraphFromWizard>,
    metadata?: { name?: string; description?: string },
  ) => void | Promise<void>;
  isSaving?: boolean;
  saveError?: string;
  saveMessage?: string;
  onSwitchToVisual?: () => void;
}

export function WizardReviewStep({
  state,
  onGoToStep,
  onSave,
  isSaving = false,
  saveError,
  saveMessage,
  onSwitchToVisual,
}: WizardReviewStepProps) {
  const canonicalGraph = buildCanonicalGraphFromWizard(state);
  const contractIssues = validateWorkflowGraphDetailed(canonicalGraph);
  const isValid = contractIssues.length === 0 && Boolean(state.name.trim());

  return (
    <div className="wizard-step">
      <div className="wizard-step__header">
        <h3 className="wizard-step__title">Step 4: Review and Save Your Workflow</h3>
        <p className="wizard-step__description">
          Review your configured workflow steps below. The wizard validates the workflow against the canonical execution contract in real time.
        </p>
      </div>

      {saveError && (
        <div className="wizard-alert wizard-alert--danger" role="alert">
          <strong>Save failed:</strong> {saveError}
        </div>
      )}

      {saveMessage && (
        <div className="wizard-alert wizard-alert--success" role="status">
          {saveMessage}
        </div>
      )}

      <div className="wizard-validation-status">
        {isValid ? (
          <div className="wizard-status-banner wizard-status-banner--valid">
            <span className="wizard-status-banner__icon">✓</span>
            <div>
              <h4 className="wizard-status-banner__title">Workflow is valid and ready</h4>
              <p className="wizard-status-banner__desc">
                All steps, trigger configurations, and condition branches conform to the workflow contract.
              </p>
            </div>
          </div>
        ) : (
          <div className="wizard-status-banner wizard-status-banner--invalid" role="alert">
            <span className="wizard-status-banner__icon">!</span>
            <div>
              <h4 className="wizard-status-banner__title">Action needed before saving</h4>
              <ul className="wizard-status-banner__issues">
                {!state.name.trim() && (
                  <li>
                    Workflow name is missing.{" "}
                    <button
                      type="button"
                      className="wizard-link-button"
                      onClick={() => onGoToStep(0)}
                    >
                      Fix in Step 1
                    </button>
                  </li>
                )}
                {contractIssues.map((issue) => (
                  <li key={issue.message}>
                    {issue.message}{" "}
                    <button
                      type="button"
                      className="wizard-link-button"
                      onClick={() => onGoToStep(2)}
                    >
                      Fix in Step 3
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="wizard-review-section">
        <div className="wizard-review-card">
          <div className="wizard-review-card__header">
            <h4>1. Basic Details</h4>
            <button
              type="button"
              className="wizard-button wizard-button--small"
              onClick={() => onGoToStep(0)}
            >
              Edit Details
            </button>
          </div>
          <dl className="wizard-dl">
            <div>
              <dt>Name</dt>
              <dd>{state.name || "Untitled workflow"}</dd>
            </div>
            {state.description && (
              <div>
                <dt>Description</dt>
                <dd>{state.description}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="wizard-review-card">
          <div className="wizard-review-card__header">
            <h4>2. Trigger</h4>
            <button
              type="button"
              className="wizard-button wizard-button--small"
              onClick={() => onGoToStep(1)}
            >
              Edit Trigger
            </button>
          </div>
          <dl className="wizard-dl">
            <div>
              <dt>Trigger Name</dt>
              <dd>{state.trigger.label}</dd>
            </div>
            <div>
              <dt>Trigger Type</dt>
              <dd>
                {state.trigger.kind === "event"
                  ? `Business Event: ${state.trigger.eventName}`
                  : state.trigger.kind === "schedule"
                    ? `Schedule: ${state.trigger.cron} (${state.trigger.timezone})`
                    : `Webhook: ${state.trigger.webhookMethod} ${state.trigger.webhookPath}`}
              </dd>
            </div>
          </dl>
        </div>

        <div className="wizard-review-card">
          <div className="wizard-review-card__header">
            <h4>3. Configured Steps & Outcomes</h4>
            <button
              type="button"
              className="wizard-button wizard-button--small"
              onClick={() => onGoToStep(2)}
            >
              Edit Steps
            </button>
          </div>

          <div className="wizard-review-steps">
            {state.steps.map((step, idx) => (
              <div key={step.id} className="wizard-review-step-item">
                <div className="wizard-review-step-item__title">
                  <span className="wizard-review-step-item__num">{idx + 1}</span>
                  <strong>{step.label}</strong>
                  <span className={`wizard-badge wizard-badge--${step.type}`}>
                    {step.type === "condition" ? "Decision" : "Action"}
                  </span>
                </div>

                {step.type === "task" ? (
                  <p className="wizard-review-step-item__detail">
                    Action: <code>{step.action}</code>
                    {step.action === "http" && ` (${step.httpMethod} ${step.httpUrl})`}
                    {step.action === "sendEmail" && ` (To: ${step.emailTo})`}
                    {step.action === "sendSlack" && ` (Channel: ${step.slackChannel})`}
                  </p>
                ) : (
                  <div className="wizard-review-step-item__condition">
                    <p className="wizard-review-condition-rule">
                      {summarizeCondition({
                        left: step.left,
                        op: step.op,
                        right: step.right,
                      })}
                    </p>
                    <div className="wizard-review-branches">
                      <div className="wizard-review-branch wizard-review-branch--true">
                        <span className="wizard-badge wizard-badge--true">If True (Yes)</span>
                        <span>{step.trueTarget.label} ({step.trueTarget.action})</span>
                      </div>
                      <div className="wizard-review-branch wizard-review-branch--false">
                        <span className="wizard-badge wizard-badge--false">If False (No)</span>
                        <span>{step.falseTarget.label} ({step.falseTarget.action})</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="wizard-review-actions">
        {onSave && (
          <button
            type="button"
            className="wizard-button wizard-button--primary wizard-button--large"
            disabled={isSaving || !isValid}
            onClick={() =>
              void onSave(canonicalGraph, {
                name: state.name,
                description: state.description,
              })
            }
          >
            {isSaving ? "Saving Workflow..." : "Save Workflow"}
          </button>
        )}

        {onSwitchToVisual && (
          <button
            type="button"
            className="wizard-button wizard-button--outline"
            onClick={onSwitchToVisual}
          >
            Open in Visual Canvas Editor
          </button>
        )}
      </div>
    </div>
  );
}

