import type { WizardState, TriggerKind, WizardTrigger } from "./wizardState";

interface WizardTriggerStepProps {
  state: WizardState;
  onChange: (updates: { trigger: WizardTrigger }) => void;
  errors: Array<{ field?: string; message: string }>;
}

export function WizardTriggerStep({
  state,
  onChange,
  errors,
}: WizardTriggerStepProps) {
  const trigger = state.trigger;
  const eventNameError = errors.find((e) => e.field === "trigger.eventName")?.message;
  const labelError = errors.find((e) => e.field === "trigger.label")?.message;

  function setTriggerKind(kind: TriggerKind) {
    onChange({
      trigger: {
        ...trigger,
        kind,
        label:
          kind === "event"
            ? "Business event received"
            : kind === "schedule"
              ? "Scheduled timer"
              : "Incoming webhook request",
      },
    });
  }

  function updateField<K extends keyof WizardTrigger>(field: K, value: WizardTrigger[K]) {
    onChange({
      trigger: {
        ...trigger,
        [field]: value,
      },
    });
  }

  return (
    <div className="wizard-step">
      <div className="wizard-step__header">
        <h3 className="wizard-step__title">Step 2: Choose How Your Workflow Starts</h3>
        <p className="wizard-step__description">
          Select what event or condition should trigger this workflow to run automatically.
        </p>
      </div>

      <div className="wizard-form-group">
        <label htmlFor="wizard-trigger-label" className="wizard-label">
          Trigger Name / Label <span className="wizard-required">*</span>
        </label>
        <input
          id="wizard-trigger-label"
          type="text"
          className={`wizard-input ${labelError ? "wizard-input--error" : ""}`}
          value={trigger.label}
          maxLength={120}
          onChange={(e) => updateField("label", e.target.value)}
        />
        {labelError && <span className="wizard-field-error" role="alert">{labelError}</span>}
      </div>

      <div className="wizard-radio-cards">
        <div
          className={`wizard-radio-card ${trigger.kind === "event" ? "wizard-radio-card--selected" : ""}`}
          onClick={() => setTriggerKind("event")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") setTriggerKind("event");
          }}
        >
          <div className="wizard-radio-card__badge">Recommended</div>
          <h4 className="wizard-radio-card__title">Business Event</h4>
          <p className="wizard-radio-card__description">
            Runs when a domain event (like <code>order.created</code> or <code>user.signup</code>) is inserted into the system change stream.
          </p>
        </div>

        <div
          className={`wizard-radio-card ${trigger.kind === "webhook" ? "wizard-radio-card--selected" : ""}`}
          onClick={() => setTriggerKind("webhook")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") setTriggerKind("webhook");
          }}
        >
          <h4 className="wizard-radio-card__title">HTTP Webhook</h4>
          <p className="wizard-radio-card__description">
            Runs whenever an external system or service sends an HTTP request to your webhook endpoint.
          </p>
        </div>

        <div
          className={`wizard-radio-card ${trigger.kind === "schedule" ? "wizard-radio-card--selected" : ""}`}
          onClick={() => setTriggerKind("schedule")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") setTriggerKind("schedule");
          }}
        >
          <h4 className="wizard-radio-card__title">Scheduled Timer</h4>
          <p className="wizard-radio-card__description">
            Runs on a recurring schedule defined by standard cron syntax (e.g. every hour or every Monday morning).
          </p>
        </div>
      </div>

      {trigger.kind === "event" && (
        <div className="wizard-panel">
          <h4 className="wizard-panel__title">Business Event Configuration</h4>
          <div className="wizard-form-group">
            <label className="wizard-label">
              Event Source (Fixed)
            </label>
            <input
              type="text"
              className="wizard-input wizard-input--disabled"
              value="business_events"
              disabled
              readOnly
            />
            <span className="wizard-hint">
              All events are securely ingested through the verified <code>business_events</code> change stream.
            </span>
          </div>

          <div className="wizard-form-group">
            <label htmlFor="wizard-event-name" className="wizard-label">
              Event Name to Listen For <span className="wizard-required">*</span>
            </label>
            <input
              id="wizard-event-name"
              type="text"
              className={`wizard-input ${eventNameError ? "wizard-input--error" : ""}`}
              placeholder="e.g. order.created"
              value={trigger.eventName}
              onChange={(e) => updateField("eventName", e.target.value)}
            />
            {eventNameError ? (
              <span className="wizard-field-error" role="alert">{eventNameError}</span>
            ) : (
              <span className="wizard-hint">Common examples: <code>order.created</code>, <code>payment.received</code>, <code>invoice.paid</code></span>
            )}
          </div>
        </div>
      )}

      {trigger.kind === "webhook" && (
        <div className="wizard-panel">
          <h4 className="wizard-panel__title">Webhook Configuration</h4>
          <div className="wizard-grid-2">
            <div className="wizard-form-group">
              <label htmlFor="wizard-webhook-method" className="wizard-label">HTTP Method</label>
              <select
                id="wizard-webhook-method"
                className="wizard-select"
                value={trigger.webhookMethod}
                onChange={(e) =>
                  updateField(
                    "webhookMethod",
                    e.target.value as WizardTrigger["webhookMethod"],
                  )
                }
              >
                <option value="POST">POST</option>
                <option value="GET">GET</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
            <div className="wizard-form-group">
              <label htmlFor="wizard-webhook-path" className="wizard-label">Endpoint Path</label>
              <input
                id="wizard-webhook-path"
                type="text"
                className="wizard-input"
                value={trigger.webhookPath}
                onChange={(e) => updateField("webhookPath", e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {trigger.kind === "schedule" && (
        <div className="wizard-panel">
          <h4 className="wizard-panel__title">Schedule Configuration</h4>
          <div className="wizard-grid-2">
            <div className="wizard-form-group">
              <label htmlFor="wizard-cron-expression" className="wizard-label">Cron Expression</label>
              <input
                id="wizard-cron-expression"
                type="text"
                className="wizard-input"
                placeholder="0 * * * *"
                value={trigger.cron}
                onChange={(e) => updateField("cron", e.target.value)}
              />
              <span className="wizard-hint">e.g. <code>0 9 * * 1-5</code> (Mon-Fri 9:00 AM)</span>
            </div>
            <div className="wizard-form-group">
              <label htmlFor="wizard-timezone" className="wizard-label">Timezone</label>
              <input
                id="wizard-timezone"
                type="text"
                className="wizard-input"
                value={trigger.timezone}
                onChange={(e) => updateField("timezone", e.target.value)}
              />
              <span className="wizard-hint">Standard IANA timezone (e.g. UTC, America/New_York)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

