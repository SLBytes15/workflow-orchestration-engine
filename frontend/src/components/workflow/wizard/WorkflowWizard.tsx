import { useState, useMemo, useEffect } from "react";
import type { WorkflowGraph } from "../../../api/workflowApi";
import {
  buildCanonicalGraphFromWizard,
  parseGraphToWizardState,
  validateWizardState,
  type WizardState,
} from "./wizardState";
import { WizardDetailsStep } from "./WizardDetailsStep";
import { WizardTriggerStep } from "./WizardTriggerStep";
import { WizardStepsStep } from "./WizardStepsStep";
import { WizardReviewStep } from "./WizardReviewStep";
import "./workflowWizard.css";

interface WorkflowWizardProps {
  initialGraph?: WorkflowGraph | null;
  workflowId?: string;
  workflowName?: string;
  workflowDescription?: string;
  onGraphChange?: (graph: WorkflowGraph) => void;
  onSaveGraph?: (
    graph: WorkflowGraph,
    metadata?: { name?: string; description?: string },
  ) => void | Promise<void>;
  isSaving?: boolean;
  saveError?: string;
  saveMessage?: string;
  onSwitchToVisual?: () => void;
}

const STEP_LABELS = [
  "1. Details",
  "2. Trigger",
  "3. Steps & Logic",
  "4. Review & Save",
];

export function WorkflowWizard({
  initialGraph,
  workflowId,
  workflowName,
  workflowDescription,
  onGraphChange,
  onSaveGraph,
  isSaving = false,
  saveError,
  saveMessage,
  onSwitchToVisual,
}: WorkflowWizardProps) {
  const [state, setState] = useState<WizardState>(() =>
    parseGraphToWizardState(initialGraph, workflowName, workflowDescription),
  );
  const [stepErrors, setStepErrors] = useState<Array<{ step: number; field?: string; message: string }>>([]);

  const currentStep = state.currentStepIndex;

  // Compute canonical graph whenever state changes
  const canonicalGraph = useMemo(() => buildCanonicalGraphFromWizard(state), [state]);

  // Synchronize canonical graph with parent container
  useEffect(() => {
    onGraphChange?.(canonicalGraph);
  }, [canonicalGraph, onGraphChange]);

  function handleStateChange(updates: Partial<WizardState>) {
    setState((prev) => ({
      ...prev,
      ...updates,
    }));
    // Clear field-level errors as user types
    setStepErrors([]);
  }

  function handleNext() {
    const allErrors = validateWizardState(state);
    const currentStepErrors = allErrors.filter((e) => e.step === currentStep);

    if (currentStepErrors.length > 0) {
      setStepErrors(currentStepErrors);
      return;
    }

    setStepErrors([]);
    setState((prev) => ({
      ...prev,
      currentStepIndex: Math.min(prev.currentStepIndex + 1, STEP_LABELS.length - 1),
    }));
  }

  function handleBack() {
    setStepErrors([]);
    setState((prev) => ({
      ...prev,
      currentStepIndex: Math.max(prev.currentStepIndex - 1, 0),
    }));
  }

  function handleGoToStep(stepIndex: number) {
    setStepErrors([]);
    setState((prev) => ({
      ...prev,
      currentStepIndex: stepIndex,
    }));
  }

  return (
    <div className="workflow-wizard">
      <div className="workflow-wizard__top-bar">
        <div>
          <span className="workflow-wizard__eyebrow">Guided Workflow Builder</span>
          <h2 className="workflow-wizard__heading">
            {workflowId ? `Editing: ${state.name || "Untitled"}` : "Create New Workflow"}
          </h2>
        </div>

        {onSwitchToVisual && (
          <button
            type="button"
            className="wizard-button wizard-button--outline"
            onClick={onSwitchToVisual}
          >
            Switch to Visual Canvas Editor
          </button>
        )}
      </div>

      <nav aria-label="Wizard Steps Progress" className="workflow-wizard__stepper">
        {STEP_LABELS.map((label, index) => {
          const isCurrent = index === currentStep;
          const isCompleted = index < currentStep;

          return (
            <button
              key={label}
              type="button"
              className={`workflow-wizard__step-button ${
                isCurrent ? "workflow-wizard__step-button--current" : ""
              } ${isCompleted ? "workflow-wizard__step-button--completed" : ""}`}
              onClick={() => handleGoToStep(index)}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className="workflow-wizard__step-indicator">
                {isCompleted ? "✓" : index + 1}
              </span>
              <span className="workflow-wizard__step-label">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="workflow-wizard__content">
        {currentStep === 0 && (
          <WizardDetailsStep
            state={state}
            onChange={handleStateChange}
            errors={stepErrors}
          />
        )}

        {currentStep === 1 && (
          <WizardTriggerStep
            state={state}
            onChange={handleStateChange}
            errors={stepErrors}
          />
        )}

        {currentStep === 2 && (
          <WizardStepsStep
            state={state}
            onChange={handleStateChange}
            errors={stepErrors}
          />
        )}

        {currentStep === 3 && (
          <WizardReviewStep
            state={state}
            onGoToStep={handleGoToStep}
            onSave={(canonicalGraph, metadata) =>
              onSaveGraph?.(
                canonicalGraph,
                metadata ?? {
                  name: state.name,
                  description: state.description,
                },
              )
            }
            isSaving={isSaving}
            saveError={saveError}
            saveMessage={saveMessage}
            onSwitchToVisual={onSwitchToVisual}
          />
        )}
      </div>

      <div className="workflow-wizard__nav">
        <button
          type="button"
          className="wizard-button wizard-button--secondary"
          onClick={handleBack}
          disabled={currentStep === 0}
        >
          ← Back
        </button>

        {currentStep < STEP_LABELS.length - 1 && (
          <button
            type="button"
            className="wizard-button wizard-button--primary"
            onClick={handleNext}
          >
            Next: {STEP_LABELS[currentStep + 1]} →
          </button>
        )}
      </div>
    </div>
  );
}

export default WorkflowWizard;

