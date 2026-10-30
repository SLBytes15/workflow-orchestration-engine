import type { WizardState } from "./wizardState";

interface WizardDetailsStepProps {
  state: WizardState;
  onChange: (updates: Partial<WizardState>) => void;
  errors: Array<{ field?: string; message: string }>;
}

export function WizardDetailsStep({
  state,
  onChange,
  errors,
}: WizardDetailsStepProps) {
  const nameError = errors.find((e) => e.field === "name")?.message;
  const descriptionError = errors.find((e) => e.field === "description")?.message;

  return (
    <div className="wizard-step">
      <div className="wizard-step__header">
        <h3 className="wizard-step__title">Step 1: Workflow Details</h3>
        <p className="wizard-step__description">
          Give your workflow a clear name and optional description so your team can easily identify what it does.
        </p>
      </div>

      <div className="wizard-form-group">
        <label htmlFor="wizard-workflow-name" className="wizard-label">
          Workflow Name <span className="wizard-required">*</span>
        </label>
        <input
          id="wizard-workflow-name"
          type="text"
          className={`wizard-input ${nameError ? "wizard-input--error" : ""}`}
          placeholder="e.g., Order Approval and Payment Flow"
          value={state.name}
          maxLength={120}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <div className="wizard-hint-row">
          {nameError ? (
            <span className="wizard-field-error" role="alert">{nameError}</span>
          ) : (
            <span className="wizard-hint">Up to 120 characters</span>
          )}
          <span className="wizard-counter">{state.name.length} / 120</span>
        </div>
      </div>

      <div className="wizard-form-group">
        <label htmlFor="wizard-workflow-description" className="wizard-label">
          Description (Optional)
        </label>
        <textarea
          id="wizard-workflow-description"
          className={`wizard-textarea ${descriptionError ? "wizard-textarea--error" : ""}`}
          placeholder="Briefly describe what triggers this workflow and the actions it executes..."
          rows={4}
          maxLength={2000}
          value={state.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
        <div className="wizard-hint-row">
          {descriptionError ? (
            <span className="wizard-field-error" role="alert">{descriptionError}</span>
          ) : (
            <span className="wizard-hint">Optional summary of workflow business logic</span>
          )}
          <span className="wizard-counter">{state.description.length} / 2000</span>
        </div>
      </div>
    </div>
  );
}

