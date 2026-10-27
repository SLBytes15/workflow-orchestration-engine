import { startExecution, type WorkflowExecution } from "../api/executionApi";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import WorkflowCard from "../components/workflows/WorkflowCard";
import WorkflowListState from "../components/workflows/WorkflowListState";
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflows,
  type WorkflowGraph,
} from "../api/workflowApi";
import {
  appendWorkflow,
  initialWorkflows,
  mapPersistedWorkflow,
  mergeSavedWorkflows,
  removeWorkflow,
  type Workflow,
} from "../workflowState";
import { getConditionConfigError } from "../components/workflow/nodes/node.types";
import "./WorkflowsPage.css";

type WorkflowsPageProps = {
  graph: WorkflowGraph | null;
  tenantApiKey?: string;
  onEditWorkflow?: (workflowId: string, graph: WorkflowGraph) => void;
  onWorkflowDeleted?: (workflowId: string) => void;
  workflows?: Workflow[];
  onWorkflowsChange?: (workflows: Workflow[]) => void;
  initialCreateOpen?: boolean;
  onClearInitialCreateOpen?: () => void;
};

function WorkflowsPage({
  graph,
  tenantApiKey,
  onEditWorkflow,
  onWorkflowDeleted,
  workflows: propsWorkflows,
  onWorkflowsChange,
  initialCreateOpen,
  onClearInitialCreateOpen,
}: WorkflowsPageProps) {
  const normalizedTenantApiKey = tenantApiKey?.trim() || null;
  const [workflowState, setWorkflowState] = useState<{
    tenantApiKey: string | null;
    workflows: Workflow[];
  }>({
    tenantApiKey: normalizedTenantApiKey,
    workflows: initialWorkflows,
  });
  const workflows =
    propsWorkflows ??
    (workflowState.tenantApiKey === normalizedTenantApiKey
      ? workflowState.workflows
      : initialWorkflows);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [isCreateOpen, setIsCreateOpen] = useState(Boolean(initialCreateOpen));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState("");
  const [apiError, setApiError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingWorkflowId, setDeletingWorkflowId] = useState<string | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState("");

  // Saved workflow loading state
  const [isLoadingSavedWorkflows, setIsLoadingSavedWorkflows] =
    useState(Boolean(tenantApiKey?.trim()));
  const [workflowLoadError, setWorkflowLoadError] = useState("");
  const [workflowReloadKey, setWorkflowReloadKey] = useState(0);

  // Workflow execution state
  const [runningWorkflowId, setRunningWorkflowId] =
    useState<string | null>(null);
  const [executionMessage, setExecutionMessage] = useState("");
  const [executionError, setExecutionError] = useState("");
  const [lastExecution, setLastExecution] =
    useState<WorkflowExecution | null>(null);

  const createButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialCreateOpen) {
      onClearInitialCreateOpen?.();
    }
  }, [initialCreateOpen, onClearInitialCreateOpen]);

  const closeCreateModal = useCallback(() => {
    if (isSaving) return;

    setIsCreateOpen(false);
    setName("");
    setDescription("");
    setNameError("");
    setApiError("");

    window.setTimeout(() => createButtonRef.current?.focus(), 0);
  }, [isSaving]);

  // Load workflows saved in the backend.
  useEffect(() => {
    if (!tenantApiKey?.trim()) {
      setIsLoadingSavedWorkflows(false);
      setWorkflowLoadError("");
      return;
    }

    let cancelled = false;
    setIsLoadingSavedWorkflows(true);
    setWorkflowLoadError("");

    async function loadWorkflows() {
      try {
        const result = await getWorkflows(tenantApiKey!);

        if (cancelled) return;

        const savedWorkflows: Workflow[] = result.workflows.map(
          (item, index) => ({
            id: String(item.id ?? item._id ?? `saved-${index}`),
            isPersisted: Boolean(item.id ?? item._id),
            graph: item.graph as WorkflowGraph | undefined,
            name: item.name ?? "Untitled workflow",
            description: item.description ?? "No description provided.",
            status:
              item.status === "Active" ||
              item.status === "Paused" ||
              item.status === "Draft"
                ? item.status
                : "Draft",
            version: item.version ?? 1,
            updatedAt: item.updatedAt
              ? String(item.updatedAt).slice(0, 10)
              : new Date().toISOString().slice(0, 10),
          }),
        );

        setWorkflowState((current) => {
          const currentWorkflows =
            current.tenantApiKey === normalizedTenantApiKey
              ? current.workflows
              : initialWorkflows;
          const savedNames = new Set(
            savedWorkflows.map((workflow) => workflow.name.toLowerCase()),
          );

          const demosWithoutDuplicates = currentWorkflows.filter(
            (workflow) =>
              workflow.isPersisted ||
              !savedNames.has(workflow.name.toLowerCase()),
          );

          const merged = mergeSavedWorkflows(
            demosWithoutDuplicates,
            savedWorkflows,
          );
          onWorkflowsChange?.(merged);
          return {
            tenantApiKey: normalizedTenantApiKey,
            workflows: merged,
          };
        });
      } catch (error) {
        console.error("Unable to load saved workflows:", error);

        if (!cancelled) {
          setWorkflowLoadError(
            error instanceof Error
              ? error.message
              : "Saved workflows could not be loaded. Please try again.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSavedWorkflows(false);
        }
      }

    };

    void loadWorkflows();

    return () => {
      cancelled = true;
    };
  }, [tenantApiKey, normalizedTenantApiKey, workflowReloadKey, onWorkflowsChange]);

  // Manage keyboard focus inside the create-workflow dialog.
  useEffect(() => {
    if (!isCreateOpen) return;

    nameInputRef.current?.focus();

    function handleModalKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeCreateModal();
        return;
      }

      if (event.key !== "Tab" || !modalRef.current) return;

      const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );

      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleModalKeyDown);

    return () => {
      document.removeEventListener("keydown", handleModalKeyDown);
    };
  }, [isCreateOpen, closeCreateModal]);

  const filteredWorkflows = workflows.filter((workflow) => {
    const query = search.trim().toLowerCase();

    const matchesSearch =
      workflow.name.toLowerCase().includes(query) ||
      workflow.description.toLowerCase().includes(query);

    const matchesStatus =
      statusFilter === "All" || workflow.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  async function handleCreateWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSaving) return;

    const trimmedName = name.trim();
    const trimmedDescription = description.trim();

    setNameError("");
    setApiError("");

    if (!trimmedName) {
      setNameError("Please enter a workflow name.");
      return;
    }

    const duplicate = workflows.some(
      (workflow) => workflow.name.toLowerCase() === trimmedName.toLowerCase(),
    );

    if (duplicate) {
      setNameError("A workflow with this name already exists.");
      return;
    }

    if (!graph) {
      setApiError(
        "No workflow graph is available. Open Node Preview and prepare a graph before saving.",
      );
      return;
    }

    const graphConfigError = getConditionConfigError(graph);
    if (graphConfigError) {
      setApiError(graphConfigError);
      return;
    }

    if (!tenantApiKey?.trim()) {
      setApiError(
        "API authentication is not configured. Ask your team for the approved development API-key setup.",
      );
      return;
    }

    setIsSaving(true);

    try {
      const result = await createWorkflow(
        {
          name: trimmedName,
          ...(trimmedDescription ? { description: trimmedDescription } : {}),
          graph,
        },
        tenantApiKey,
      );

      const savedWorkflow = result?.workflow;

      if (!savedWorkflow) {
        throw new Error(
          "The backend response did not contain a saved workflow. Please verify the API response.",
        );
      }

      const newWorkflow = mapPersistedWorkflow(savedWorkflow, {
        name: trimmedName,
        description: trimmedDescription || "No description provided.",
      });

      setWorkflowState((current) => {
        const next = appendWorkflow(
          current.tenantApiKey === normalizedTenantApiKey
            ? current.workflows
            : initialWorkflows,
          newWorkflow,
        );
        onWorkflowsChange?.(next);
        return {
          tenantApiKey: normalizedTenantApiKey,
          workflows: next,
        };
      });

      setSearch("");
      setStatusFilter("All");
      setIsCreateOpen(false);
      setName("");
      setDescription("");
      setNameError("");
      setApiError("");

      window.setTimeout(() => createButtonRef.current?.focus(), 0);
    } catch (error) {
      setApiError(
        error instanceof Error
          ? error.message
          : "Unable to save the workflow. Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }
  async function handleRunWorkflow(workflow: Workflow) {
    if (!workflow.isPersisted) {
      setExecutionError(
        "This is a sample workflow. Save it to the backend before running it.",
      );
      setExecutionMessage("");
      return;
    }

    if (workflow.graph) {
      const graphConfigError = getConditionConfigError(workflow.graph);
      if (graphConfigError) {
        setExecutionError(graphConfigError);
        setExecutionMessage("");
        return;
      }
    }

    if (!tenantApiKey?.trim()) {
      setExecutionError("API authentication is not configured.");
      setExecutionMessage("");
      return;
    }

    if (runningWorkflowId) return;

    setRunningWorkflowId(String(workflow.id));
    setExecutionError("");
    setExecutionMessage("");
    setLastExecution(null);

    try {
      const execution = await startExecution(
        String(workflow.id),
        tenantApiKey,
        { approved: true, paymentMethod: "card" },
      );
      setLastExecution(execution);

      if (execution.status === "completed") {
        setExecutionMessage(
          `Workflow "${workflow.name}" completed successfully.`,
        );
      } else {
        setExecutionError(
          typeof execution.error === "string"
            ? execution.error
            : execution.error?.message ||
                `Workflow execution ended with status "${execution.status}".`,
        );
      }
    } catch (error) {
      setExecutionError(
        error instanceof Error
          ? error.message
          : "Unable to execute the workflow.",
      );
    } finally {
      setRunningWorkflowId(null);
    }
  }

  async function handleDeleteWorkflow(workflow: Workflow) {
    if (!workflow.isPersisted || deletingWorkflowId) return;

    const workflowId = String(workflow.id);
    if (
      !window.confirm(
        `Delete workflow "${workflow.name}"? This action cannot be undone.`,
      )
    ) {
      return;
    }

    setDeletingWorkflowId(workflowId);
    setDeleteError("");
    try {
      if (!tenantApiKey?.trim()) {
        throw new Error("API authentication is not configured.");
      }
      await deleteWorkflow(workflowId, tenantApiKey);
      setWorkflowState((current) => {
        const next =
          current.tenantApiKey === normalizedTenantApiKey
            ? removeWorkflow(current.workflows, workflow.id)
            : current.workflows;
        onWorkflowsChange?.(next);
        return {
          ...current,
          workflows: next,
        };
      });
      onWorkflowDeleted?.(workflowId);
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : `Unable to delete "${workflow.name}". Please try again.`,
      );
    } finally {
      setDeletingWorkflowId(null);
    }
  }

  return (
    <section className="workflows-page">
      <header className="workflows-page__header">
        <div>
          <p className="workflows-page__eyebrow">WORKFLOW MANAGEMENT</p>
          <h1>Workflows</h1>
          <p>Build, search, and manage your workflow definitions.</p>
        </div>

        <button
          ref={createButtonRef}
          type="button"
          className="workflows-page__create"
          onClick={() => {
            setApiError("");
            setIsCreateOpen(true);
          }}
        >
          <span aria-hidden="true">+</span> Create workflow
        </button>
      </header>

      <p className="workflows-page__demo-note">
        Sample workflows are displayed for demonstration. Workflows created
        through the form are added after the backend confirms a successful save.
        Saved workflows are loaded from the backend when authentication is
        configured.
      </p>

      {isLoadingSavedWorkflows && (
        <p className="workflows-page__load-status" role="status" aria-live="polite">
          Loading saved workflows...
        </p>
      )}

      {workflowLoadError && (
        <div className="workflows-page__load-error" role="alert">
          <p>Saved workflows could not be refreshed: {workflowLoadError}</p>
          <button
            type="button"
            className="workflows-page__secondary"
            onClick={() => {
              setWorkflowLoadError('')
              setIsLoadingSavedWorkflows(true)
              setWorkflowReloadKey((current) => current + 1)
            }}
            disabled={isLoadingSavedWorkflows}
          >
            Try again
          </button>
        </div>
      )}

      <p className="workflows-page__note" role="status">
        {graph
          ? `Workflow graph available (${graph.nodes.length} nodes, ${graph.edges.length} edges).`
          : "Open Node Preview to prepare a workflow graph."}
      </p>

      <div className="workflows-page__filters">
        <div className="workflows-page__search-field">
          <label htmlFor="workflow-search">Search workflows</label>
          <input
            id="workflow-search"
            type="search"
            placeholder="Search by name or description..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="workflows-page__status-field">
          <label htmlFor="workflow-status">Filter by status</label>
          <select
            id="workflow-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option>All</option>
            <option>Active</option>
            <option>Draft</option>
            <option>Paused</option>
          </select>
        </div>
      </div>

      {(executionMessage || executionError || lastExecution || deleteError) && (
        <div className="workflows-page__feedback-banner" role="region" aria-label="Workflow execution feedback">
          {executionMessage && (
            <p role="status" className="workflows-page__feedback-message workflows-page__feedback-message--success">
              ✓ {executionMessage}
            </p>
          )}

          {executionError && (
            <p role="alert" className="workflows-page__feedback-message workflows-page__feedback-message--error">
              ⚠ {executionError}
            </p>
          )}

          {lastExecution && !executionError && (
            <p className="workflows-page__feedback-message workflows-page__feedback-message--info">
              Execution status: <strong>{lastExecution.status}</strong>
              {" · "}
              Nodes recorded: {lastExecution.nodeResults?.length ?? 0}
            </p>
          )}

          {deleteError && (
            <p role="alert" className="workflows-page__feedback-message workflows-page__feedback-message--error">
              ⚠ {deleteError}
            </p>
          )}
        </div>
      )}

      <div className="workflows-page__results-heading">
        <h2>All workflows</h2>
        <span className="workflows-page__results-count">
          Showing {filteredWorkflows.length} of {workflows.length} {workflows.length === 1 ? 'workflow' : 'workflows'}
        </span>
      </div>

      {workflows.length === 0 ? (

        <WorkflowListState
          loading={isLoadingSavedWorkflows}
          hasWorkflows={false}
        />

      ) : filteredWorkflows.length === 0 ? (
        <div className="workflows-page__empty" role="status">
          <h2>No matching workflows</h2>
          <p>Try another search term or change the status filter.</p>
          <button
            type="button"
            className="workflows-page__secondary"
            onClick={() => {
              setSearch("");
              setStatusFilter("All");
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="workflows-page__list">
          {filteredWorkflows.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              name={workflow.name}
              description={workflow.description}
              status={workflow.status}
              version={workflow.version}
              updatedAt={workflow.updatedAt}
              onOpen={
                workflow.isPersisted && workflow.graph && onEditWorkflow
                  ? () =>
                      onEditWorkflow(String(workflow.id), workflow.graph!)
                  : undefined
              }
              
              onDelete={
                workflow.isPersisted
                  ? () => void handleDeleteWorkflow(workflow)
                  : undefined
              }
              isDeleting={deletingWorkflowId === String(workflow.id)}
              canRun={workflow.isPersisted}
              onEdit={
  workflow.isPersisted && workflow.graph && onEditWorkflow
    ? () => onEditWorkflow(String(workflow.id), workflow.graph!)
    : undefined
}
              isRunning={runningWorkflowId === String(workflow.id)}
              onRun={() => void handleRunWorkflow(workflow)}
            />
          ))}
        </div>
      )}

      {isCreateOpen && (
        <div
          className="workflows-page__modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSaving) {
              closeCreateModal();
            }
          }}
        >
          <section
            ref={modalRef}
            className="workflows-page__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workflow-modal-title"
          >
            <header className="workflows-page__modal-header">
              <div>
                <p className="workflows-page__eyebrow">NEW DEFINITION</p>
                <h2 id="workflow-modal-title">Create workflow</h2>
                <p>Give your workflow a name and an optional description.</p>
              </div>

              <button
                type="button"
                className="workflows-page__close"
                aria-label="Close create workflow dialog"
                onClick={closeCreateModal}
                disabled={isSaving}
              >
                ×
              </button>
            </header>

            <form
              className="workflows-page__form"
              onSubmit={handleCreateWorkflow}
              noValidate
            >
              <div className="workflows-page__form-field">
                <label htmlFor="workflow-name">Workflow name *</label>
                <input
                  ref={nameInputRef}
                  id="workflow-name"
                  name="name"
                  type="text"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (nameError) setNameError("");
                    if (apiError) setApiError("");
                  }}
                  maxLength={100}
                  placeholder="e.g. Payment Processing"
                  aria-invalid={Boolean(nameError)}
                  aria-describedby={
                    nameError ? "workflow-name-error" : undefined
                  }
                  autoFocus
                  disabled={isSaving}
                />

                {nameError && (
                  <p
                    id="workflow-name-error"
                    className="workflows-page__error"
                    role="alert"
                  >
                    {nameError}
                  </p>
                )}
              </div>

              <div className="workflows-page__form-field">
                <label htmlFor="workflow-description">
                  Description <span>(optional)</span>
                </label>
                <textarea
                  id="workflow-description"
                  name="description"
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    if (apiError) setApiError("");
                  }}
                  rows={4}
                  maxLength={500}
                  placeholder="Describe what this workflow does..."
                  disabled={isSaving}
                />

                <span className="workflows-page__character-count">
                  {description.length}/500
                </span>
              </div>

              {apiError && (
                <p className="workflows-page__error" role="alert">
                  {apiError}
                </p>
              )}

              <div className="workflows-page__modal-actions">
                <button
                  type="button"
                  className="workflows-page__secondary"
                  onClick={closeCreateModal}
                  disabled={isSaving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="workflows-page__create"
                  disabled={isSaving}
                >
                  {isSaving ? "Saving..." : "Save workflow"}
                </button>
              </div>

              <p className="workflows-page__note">
                New workflows start in Draft status. Saving requires a valid
                graph and approved API authentication.
              </p>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

export default WorkflowsPage;
