import { startExecution, type WorkflowExecution } from "../api/executionApi";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import WorkflowCard from "../components/workflows/WorkflowCard";
import {
  activateWorkflow,
  createWorkflow,
  deleteWorkflow,
  getWorkflows,
  pauseWorkflow,
  resumeWorkflow,
  type WorkflowGraph,
} from "../api/workflowApi";
import {
  appendWorkflow,
  generateCopyName,
  initialWorkflows,
  isRunButtonDisabled,
  mapPersistedWorkflow,
  mergeSavedWorkflows,
  normalizeStatus,
  removeWorkflow,
  type Workflow,
} from "../workflowState";
import { getConditionConfigError } from "../components/workflow/nodes/node.types";
import ConfirmDeleteDialog from "../components/common/ConfirmDeleteDialog";
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

type SortOption = "updated-desc" | "updated-asc" | "name-asc" | "name-desc";
type ViewMode = "table" | "grid";

function formatDisplayDate(dateStr?: string): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

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
  const workflowsRef = useRef(workflows);

  // Search, filter, sort, and view mode state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortBy, setSortBy] = useState<SortOption>("updated-desc");
  const [viewMode, setViewMode] = useState<ViewMode>("table");

  // Create workflow modal state
  const [isCreateOpen, setIsCreateOpen] = useState(Boolean(initialCreateOpen));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState("");
  const [apiError, setApiError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Delete modal state
  const [workflowToDelete, setWorkflowToDelete] = useState<Workflow | null>(null);
  const [deletingWorkflowId, setDeletingWorkflowId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  // Workflow lifecycle action state
  const [activatingWorkflowId, setActivatingWorkflowId] = useState<string | null>(null);
  const [pausingWorkflowId, setPausingWorkflowId] = useState<string | null>(null);
  const [resumingWorkflowId, setResumingWorkflowId] = useState<string | null>(null);
  const [duplicatingWorkflowId, setDuplicatingWorkflowId] = useState<string | null>(null);
  const [statusActionMessage, setStatusActionMessage] = useState("");
  const [statusActionError, setStatusActionError] = useState("");

  // Saved workflow loading state
  const [isLoadingSavedWorkflows, setIsLoadingSavedWorkflows] = useState(
    Boolean(tenantApiKey?.trim()),
  );
  const [workflowLoadError, setWorkflowLoadError] = useState("");
  const [workflowReloadKey, setWorkflowReloadKey] = useState(0);

  // Workflow execution state
  const [runningWorkflowId, setRunningWorkflowId] = useState<string | null>(null);
  const [executionMessage, setExecutionMessage] = useState("");
  const [executionError, setExecutionError] = useState("");
  const [lastExecution, setLastExecution] = useState<WorkflowExecution | null>(null);

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

  const onWorkflowsChangeRef = useRef(onWorkflowsChange);
  useEffect(() => {
    onWorkflowsChangeRef.current = onWorkflowsChange;
  }, [onWorkflowsChange]);

  useEffect(() => {
    workflowsRef.current = workflows;
  }, [workflows]);

  // Load workflows saved in the backend
  useEffect(() => {
    let cancelled = false;

    async function loadWorkflows() {
      if (!tenantApiKey?.trim()) {
        setIsLoadingSavedWorkflows(false);
        setWorkflowLoadError("");
        return;
      }

      setIsLoadingSavedWorkflows(true);
      setWorkflowLoadError("");

      try {
        const result = await getWorkflows(tenantApiKey);

        if (cancelled) return;

        const savedWorkflows: Workflow[] = result.workflows.map(
          (item, index) => ({
            id: String(item.id ?? item._id ?? `saved-${index}`),
            isPersisted: Boolean(item.id ?? item._id),
            graph: item.graph as WorkflowGraph | undefined,
            name: item.name ?? "Untitled workflow",
            description: item.description ?? "No description provided.",
            status: normalizeStatus(item.status),
            version: item.version ?? 1,
            updatedAt: item.updatedAt
              ? String(item.updatedAt).slice(0, 10)
              : new Date().toISOString().slice(0, 10),
          }),
        );

        const savedNames = new Set(
          savedWorkflows.map((workflow) => workflow.name.toLowerCase()),
        );
        const demosWithoutDuplicates = workflowsRef.current.filter(
          (workflow) =>
            workflow.isPersisted ||
            !savedNames.has(workflow.name.toLowerCase()),
        );
        const merged = mergeSavedWorkflows(
          demosWithoutDuplicates,
          savedWorkflows,
        );
        const nextWorkflowState = {
          tenantApiKey: normalizedTenantApiKey,
          workflows: merged,
        };

        workflowsRef.current = merged;
        setWorkflowState(nextWorkflowState);
        onWorkflowsChangeRef.current?.(merged);
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
    }

    void loadWorkflows();

    return () => {
      cancelled = true;
    };
  }, [tenantApiKey, normalizedTenantApiKey, workflowReloadKey]);

  // Modal keyboard focus trap
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

  // Backend-driven summary metric counts
  const summaryCounts = useMemo(() => {
    let active = 0;
    let draft = 0;
    let paused = 0;

    for (const wf of workflows) {
      if (wf.status === "Active") active++;
      else if (wf.status === "Draft") draft++;
      else if (wf.status === "Paused") paused++;
    }

    return {
      total: workflows.length,
      active,
      draft,
      paused,
    };
  }, [workflows]);

  // Filtered & sorted workflows
  const sortedAndFilteredWorkflows = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = workflows.filter((workflow) => {
      const matchesSearch =
        !query ||
        workflow.name.toLowerCase().includes(query) ||
        workflow.description.toLowerCase().includes(query);

      const matchesStatus =
        statusFilter === "All" || workflow.status === statusFilter;

      return matchesSearch && matchesStatus;
    });

    return filtered.sort((a, b) => {
      switch (sortBy) {
        case "name-asc":
          return a.name.localeCompare(b.name);
        case "name-desc":
          return b.name.localeCompare(a.name);
        case "updated-asc":
          return (a.updatedAt || "").localeCompare(b.updatedAt || "");
        case "updated-desc":
        default:
          return (b.updatedAt || "").localeCompare(a.updatedAt || "");
      }
    });
  }, [workflows, search, statusFilter, sortBy]);

  const hasActiveFilters =
    Boolean(search.trim()) || statusFilter !== "All" || sortBy !== "updated-desc";

  // Create workflow handler
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

  // Duplicate workflow handler
  async function handleDuplicateWorkflow(workflow: Workflow) {
    if (!workflow.isPersisted) {
      setStatusActionError(
        "Sample workflows cannot be duplicated. Please save the workflow first.",
      );
      setStatusActionMessage("");
      return;
    }

    if (!workflow.graph) {
      setStatusActionError(
        "Cannot duplicate this workflow because its graph definition is not loaded.",
      );
      setStatusActionMessage("");
      return;
    }

    if (!tenantApiKey?.trim()) {
      setStatusActionError("API authentication is not configured.");
      setStatusActionMessage("");
      return;
    }

    const workflowId = String(workflow.id);
    setDuplicatingWorkflowId(workflowId);
    setStatusActionError("");
    setStatusActionMessage("");

    try {
      const copyName = generateCopyName(workflow.name, workflowsRef.current);
      const result = await createWorkflow(
        {
          name: copyName,
          description: workflow.description,
          graph: workflow.graph,
        },
        tenantApiKey,
      );

      const savedWorkflow = result?.workflow;
      if (!savedWorkflow) {
        throw new Error(
          "The backend response did not contain a saved workflow.",
        );
      }

      const newWorkflow = mapPersistedWorkflow(savedWorkflow, {
        name: copyName,
        description: workflow.description || "No description provided.",
      });

      setWorkflowState((current) => {
        const next = appendWorkflow(
          current.tenantApiKey === normalizedTenantApiKey
            ? current.workflows
            : initialWorkflows,
          newWorkflow,
        );
        onWorkflowsChangeRef.current?.(next);
        return {
          tenantApiKey: normalizedTenantApiKey,
          workflows: next,
        };
      });

      setStatusActionMessage(
        `Workflow "${workflow.name}" duplicated successfully as "${copyName}".`,
      );
    } catch (error) {
      setStatusActionError(
        error instanceof Error
          ? error.message
          : `Failed to duplicate "${workflow.name}".`,
      );
    } finally {
      setDuplicatingWorkflowId(null);
    }
  }

  // Run workflow handler
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

  // Lifecycle status actions
  async function handleActivateWorkflow(workflow: Workflow) {
    if (!workflow.isPersisted) return;
    if (!tenantApiKey?.trim()) {
      setStatusActionError("API authentication is not configured.");
      setStatusActionMessage("");
      return;
    }

    const workflowId = String(workflow.id);
    setActivatingWorkflowId(workflowId);
    setStatusActionError("");
    setStatusActionMessage("");

    try {
      const response = await activateWorkflow(workflowId, tenantApiKey);
      const updatedWorkflow = mapPersistedWorkflow(response.workflow, {
        name: workflow.name,
        description: workflow.description,
      });

      setWorkflowState((current) => {
        const next = current.workflows.map((item) =>
          String(item.id) === workflowId ? updatedWorkflow : item,
        );
        onWorkflowsChange?.(next);
        return { ...current, workflows: next };
      });
      setStatusActionMessage(`Workflow "${workflow.name}" is now Active.`);
    } catch (error) {
      setStatusActionError(
        error instanceof Error
          ? error.message
          : `Failed to activate "${workflow.name}".`,
      );
    } finally {
      setActivatingWorkflowId(null);
    }
  }

  async function handlePauseWorkflow(workflow: Workflow) {
    if (!workflow.isPersisted) return;
    if (!tenantApiKey?.trim()) {
      setStatusActionError("API authentication is not configured.");
      setStatusActionMessage("");
      return;
    }

    const workflowId = String(workflow.id);
    setPausingWorkflowId(workflowId);
    setStatusActionError("");
    setStatusActionMessage("");

    try {
      const response = await pauseWorkflow(workflowId, tenantApiKey);
      const updatedWorkflow = mapPersistedWorkflow(response.workflow, {
        name: workflow.name,
        description: workflow.description,
      });

      setWorkflowState((current) => {
        const next = current.workflows.map((item) =>
          String(item.id) === workflowId ? updatedWorkflow : item,
        );
        onWorkflowsChange?.(next);
        return { ...current, workflows: next };
      });
      setStatusActionMessage(`Workflow "${workflow.name}" has been Paused.`);
    } catch (error) {
      setStatusActionError(
        error instanceof Error
          ? error.message
          : `Failed to pause "${workflow.name}".`,
      );
    } finally {
      setPausingWorkflowId(null);
    }
  }

  async function handleResumeWorkflow(workflow: Workflow) {
    if (!workflow.isPersisted) return;
    if (!tenantApiKey?.trim()) {
      setStatusActionError("API authentication is not configured.");
      setStatusActionMessage("");
      return;
    }

    const workflowId = String(workflow.id);
    setResumingWorkflowId(workflowId);
    setStatusActionError("");
    setStatusActionMessage("");

    try {
      const response = await resumeWorkflow(workflowId, tenantApiKey);
      const updatedWorkflow = mapPersistedWorkflow(response.workflow, {
        name: workflow.name,
        description: workflow.description,
      });

      setWorkflowState((current) => {
        const next = current.workflows.map((item) =>
          String(item.id) === workflowId ? updatedWorkflow : item,
        );
        onWorkflowsChange?.(next);
        return { ...current, workflows: next };
      });
      setStatusActionMessage(
        `Workflow "${workflow.name}" has been Resumed to Active.`,
      );
    } catch (error) {
      setStatusActionError(
        error instanceof Error
          ? error.message
          : `Failed to resume "${workflow.name}".`,
      );
    } finally {
      setResumingWorkflowId(null);
    }
  }

  // Delete modal handlers
  function openDeleteDialog(workflow: Workflow) {
    setDeleteError("");
    setWorkflowToDelete(workflow);
  }

  function closeDeleteDialog() {
    if (deletingWorkflowId) return;
    setWorkflowToDelete(null);
    setDeleteError("");
  }

  async function handleConfirmDelete() {
    if (!workflowToDelete || deletingWorkflowId) return;

    const workflowId = String(workflowToDelete.id);
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
            ? removeWorkflow(current.workflows, workflowToDelete.id)
            : current.workflows;
        onWorkflowsChange?.(next);
        return {
          ...current,
          workflows: next,
        };
      });
      onWorkflowDeleted?.(workflowId);
      setWorkflowToDelete(null);
      setStatusActionMessage(
        `Workflow "${workflowToDelete.name}" deleted successfully.`,
      );
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : `Unable to delete "${workflowToDelete.name}". Please try again.`,
      );
    } finally {
      setDeletingWorkflowId(null);
    }
  }

  return (
    <div className="workflows-page">
      {/* 1. Breadcrumb navigation */}
      <nav className="workflows-page__breadcrumb" aria-label="Breadcrumb">
        <span className="workflows-page__breadcrumb-item">Catalog</span>
        <span
          className="workflows-page__breadcrumb-separator"
          aria-hidden="true"
        >
          /
        </span>
        <span
          className="workflows-page__breadcrumb-item workflows-page__breadcrumb-item--active"
          aria-current="page"
        >
          Workflows
        </span>
      </nav>

      {/* 2. Header */}
      <header className="workflows-page__header">
        <div className="workflows-page__header-text">
          <p className="workflows-page__eyebrow">ENTERPRISE WORKFLOW CATALOG</p>
          <h1 className="workflows-page__title">Workflow Catalog</h1>
          <p className="workflows-page__subtitle">
            Build, orchestrate, search, and manage your enterprise workflow definitions.
          </p>
        </div>

        <div className="workflows-page__header-actions">
          <button
            type="button"
            className="workflows-page__btn workflows-page__btn--secondary"
            onClick={() => {
              setWorkflowLoadError("");
              setIsLoadingSavedWorkflows(true);
              setWorkflowReloadKey((c) => c + 1);
            }}
            disabled={isLoadingSavedWorkflows}
            aria-label="Refresh workflow catalog"
          >
            <span aria-hidden="true">↻</span> Refresh
          </button>

          <button
            ref={createButtonRef}
            type="button"
            className="workflows-page__btn workflows-page__btn--primary"
            onClick={() => {
              setApiError("");
              setIsCreateOpen(true);
            }}
          >
            <span aria-hidden="true">+</span> Create workflow
          </button>
        </div>
      </header>

      {/* 3. Summary Metric Cards */}
      <section
        className="workflows-summary-grid"
        aria-label="Workflow Summary Metrics"
      >
        <button
          type="button"
          className={`workflows-summary-card ${
            statusFilter === "All" ? "workflows-summary-card--selected" : ""
          }`}
          onClick={() => setStatusFilter("All")}
          aria-label={`Total workflows: ${summaryCounts.total}. Click to show all.`}
        >
          <div className="workflows-summary-card__header">
            <span className="workflows-summary-card__label">Total Workflows</span>
            <span className="workflows-summary-card__dot workflows-summary-card__dot--total" />
          </div>
          <div className="workflows-summary-card__count">
            {summaryCounts.total}
          </div>
          <p className="workflows-summary-card__desc">All definitions in tenant</p>
        </button>

        <button
          type="button"
          className={`workflows-summary-card ${
            statusFilter === "Active" ? "workflows-summary-card--selected" : ""
          }`}
          onClick={() =>
            setStatusFilter(statusFilter === "Active" ? "All" : "Active")
          }
          aria-label={`Active workflows: ${summaryCounts.active}. Click to filter.`}
        >
          <div className="workflows-summary-card__header">
            <span className="workflows-summary-card__label">Active</span>
            <span className="workflows-summary-card__dot workflows-summary-card__dot--active" />
          </div>
          <div className="workflows-summary-card__count workflows-summary-card__count--active">
            {summaryCounts.active}
          </div>
          <p className="workflows-summary-card__desc">Live & ready to run</p>
        </button>

        <button
          type="button"
          className={`workflows-summary-card ${
            statusFilter === "Draft" ? "workflows-summary-card--selected" : ""
          }`}
          onClick={() =>
            setStatusFilter(statusFilter === "Draft" ? "All" : "Draft")
          }
          aria-label={`Draft workflows: ${summaryCounts.draft}. Click to filter.`}
        >
          <div className="workflows-summary-card__header">
            <span className="workflows-summary-card__label">Draft</span>
            <span className="workflows-summary-card__dot workflows-summary-card__dot--draft" />
          </div>
          <div className="workflows-summary-card__count workflows-summary-card__count--draft">
            {summaryCounts.draft}
          </div>
          <p className="workflows-summary-card__desc">In development</p>
        </button>

        <button
          type="button"
          className={`workflows-summary-card ${
            statusFilter === "Paused" ? "workflows-summary-card--selected" : ""
          }`}
          onClick={() =>
            setStatusFilter(statusFilter === "Paused" ? "All" : "Paused")
          }
          aria-label={`Paused workflows: ${summaryCounts.paused}. Click to filter.`}
        >
          <div className="workflows-summary-card__header">
            <span className="workflows-summary-card__label">Paused</span>
            <span className="workflows-summary-card__dot workflows-summary-card__dot--paused" />
          </div>
          <div className="workflows-summary-card__count workflows-summary-card__count--paused">
            {summaryCounts.paused}
          </div>
          <p className="workflows-summary-card__desc">Temporarily suspended</p>
        </button>
      </section>

      {/* 4. Feedback & Status Notification Banners */}
      {workflowLoadError && (
        <div
          className="workflows-page__banner workflows-page__banner--error"
          role="alert"
        >
          <div className="workflows-page__banner-content">
            <span className="workflows-page__banner-icon" aria-hidden="true">
              ⚠
            </span>
            <span>Saved workflows could not be refreshed: {workflowLoadError}</span>
          </div>
          <button
            type="button"
            className="workflows-page__btn workflows-page__btn--small"
            onClick={() => {
              setWorkflowLoadError("");
              setIsLoadingSavedWorkflows(true);
              setWorkflowReloadKey((c) => c + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}

      {(statusActionMessage ||
        statusActionError ||
        executionMessage ||
        executionError ||
        lastExecution ||
        deleteError) && (
        <div
          className="workflows-page__feedback-banner"
          role="region"
          aria-label="Workflow action feedback"
        >
          {statusActionMessage && (
            <p
              role="status"
              className="workflows-page__feedback-message workflows-page__feedback-message--success"
            >
              ✓ {statusActionMessage}
            </p>
          )}

          {statusActionError && (
            <p
              role="alert"
              className="workflows-page__feedback-message workflows-page__feedback-message--error"
            >
              ⚠ {statusActionError}
            </p>
          )}

          {executionMessage && (
            <p
              role="status"
              className="workflows-page__feedback-message workflows-page__feedback-message--success"
            >
              ✓ {executionMessage}
            </p>
          )}

          {executionError && (
            <p
              role="alert"
              className="workflows-page__feedback-message workflows-page__feedback-message--error"
            >
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
            <p
              role="alert"
              className="workflows-page__feedback-message workflows-page__feedback-message--error"
            >
              ⚠ {deleteError}
            </p>
          )}
        </div>
      )}

      {/* 5. Search, Filter, Sort & View Mode Toolbar */}
      <section
        className="workflows-toolbar"
        aria-label="Workflow search and filter controls"
      >
        <div className="workflows-toolbar__search">
          <label htmlFor="workflow-search" className="workflows-visually-hidden">
            Search workflows
          </label>
          <span className="workflows-toolbar__search-icon" aria-hidden="true">
            🔍
          </span>
          <input
            id="workflow-search"
            type="search"
            className="workflows-toolbar__search-input"
            placeholder="Search by workflow name or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="workflows-toolbar__controls">
          <div className="workflows-toolbar__control-group">
            <label htmlFor="status-filter" className="workflows-toolbar__label">
              Status:
            </label>
            <select
              id="status-filter"
              className="workflows-toolbar__select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="All">All statuses</option>
              <option value="Active">Active</option>
              <option value="Draft">Draft</option>
              <option value="Paused">Paused</option>
            </select>
          </div>

          <div className="workflows-toolbar__control-group">
            <label htmlFor="sort-by" className="workflows-toolbar__label">
              Sort by:
            </label>
            <select
              id="sort-by"
              className="workflows-toolbar__select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
            >
              <option value="updated-desc">Recently updated</option>
              <option value="updated-asc">Oldest updated</option>
              <option value="name-asc">Name (A–Z)</option>
              <option value="name-desc">Name (Z–A)</option>
            </select>
          </div>

          <div
            className="workflows-toolbar__view-toggle"
            role="group"
            aria-label="View layout"
          >
            <button
              type="button"
              className={`workflows-toolbar__view-btn ${
                viewMode === "table" ? "workflows-toolbar__view-btn--active" : ""
              }`}
              onClick={() => setViewMode("table")}
              title="Table view"
              aria-label="Table view"
              aria-pressed={viewMode === "table"}
            >
              ☰ Table
            </button>
            <button
              type="button"
              className={`workflows-toolbar__view-btn ${
                viewMode === "grid" ? "workflows-toolbar__view-btn--active" : ""
              }`}
              onClick={() => setViewMode("grid")}
              title="Card grid view"
              aria-label="Card grid view"
              aria-pressed={viewMode === "grid"}
            >
              ☷ Cards
            </button>
          </div>
        </div>
      </section>

      {/* Results heading & active filters */}
      <div className="workflows-results-bar">
        <span className="workflows-results-bar__count">
          Showing <strong>{sortedAndFilteredWorkflows.length}</strong> of{" "}
          <strong>{workflows.length}</strong>{" "}
          {workflows.length === 1 ? "workflow" : "workflows"}
        </span>

        {hasActiveFilters && (
          <button
            type="button"
            className="workflows-results-bar__clear"
            onClick={() => {
              setSearch("");
              setStatusFilter("All");
              setSortBy("updated-desc");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* 6. Content Section (Loading / Empty / Table / Grid) */}
      {isLoadingSavedWorkflows && workflows.length === 0 ? (
        <div
          className="workflows-skeleton-table"
          role="status"
          aria-live="polite"
        >
          <div className="workflows-skeleton-row workflows-skeleton-row--header" />
          <div className="workflows-skeleton-row" />
          <div className="workflows-skeleton-row" />
          <div className="workflows-skeleton-row" />
          <span className="workflows-visually-hidden">
            Loading saved workflows...
          </span>
        </div>
      ) : workflows.length === 0 ? (
        <div className="workflows-empty-state" role="status">
          <div className="workflows-empty-state__icon" aria-hidden="true">
            📋
          </div>
          <h2>No workflows created yet</h2>
          <p>
            Get started by defining your first automated process graph in the
            workflow studio.
          </p>
          <button
            type="button"
            className="workflows-page__btn workflows-page__btn--primary"
            onClick={() => {
              setApiError("");
              setIsCreateOpen(true);
            }}
          >
            + Create your first workflow
          </button>
        </div>
      ) : sortedAndFilteredWorkflows.length === 0 ? (
        <div className="workflows-empty-state" role="status">
          <div className="workflows-empty-state__icon" aria-hidden="true">
            🔍
          </div>
          <h2>No matching workflows</h2>
          <p>
            No workflows match your search query &quot;{search}&quot; or the
            selected filter criteria.
          </p>
          <button
            type="button"
            className="workflows-page__btn workflows-page__btn--secondary"
            onClick={() => {
              setSearch("");
              setStatusFilter("All");
              setSortBy("updated-desc");
            }}
          >
            Clear all filters
          </button>
        </div>
      ) : viewMode === "table" ? (
        <div className="workflows-table-container">
          <table
            className="workflows-table"
            role="table"
            aria-label="Workflow catalog table"
          >
            <thead>
              <tr>
                <th scope="col" className="workflows-table__th--name">
                  Workflow
                </th>
                <th scope="col" className="workflows-table__th--desc">
                  Description
                </th>
                <th scope="col" className="workflows-table__th--status">
                  Status
                </th>
                <th scope="col" className="workflows-table__th--version">
                  Version
                </th>
                <th scope="col" className="workflows-table__th--updated">
                  Last Updated
                </th>
                <th scope="col" className="workflows-table__th--actions">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedAndFilteredWorkflows.map((workflow) => {
                const canEdit = Boolean(
                  workflow.isPersisted && workflow.graph && onEditWorkflow,
                );
                const canRun = Boolean(workflow.isPersisted);
                const isRunning = runningWorkflowId === String(workflow.id);
                const isDuplicating =
                  duplicatingWorkflowId === String(workflow.id);
                const isActivating =
                  activatingWorkflowId === String(workflow.id);
                const isPausing = pausingWorkflowId === String(workflow.id);
                const isResuming = resumingWorkflowId === String(workflow.id);
                const isDeleting = deletingWorkflowId === String(workflow.id);

                return (
                  <tr key={workflow.id} className="workflows-table__row">
                    {/* Workflow Name */}
                    <td className="workflows-table__td--name">
                      <div className="workflow-name-cell">
                        {canEdit ? (
                          <button
                            type="button"
                            className="workflow-name-cell__link"
                            onClick={() =>
                              onEditWorkflow?.(
                                String(workflow.id),
                                workflow.graph!,
                              )
                            }
                            title={`Open and edit "${workflow.name}" in studio`}
                          >
                            {workflow.name}
                          </button>
                        ) : (
                          <span className="workflow-name-cell__title">
                            {workflow.name}
                          </span>
                        )}
                        <span
                          className={`workflow-source-pill ${
                            workflow.isPersisted
                              ? "workflow-source-pill--persisted"
                              : "workflow-source-pill--sample"
                          }`}
                        >
                          {workflow.isPersisted ? "Saved" : "Sample"}
                        </span>
                      </div>
                    </td>

                    {/* Description */}
                    <td className="workflows-table__td--desc">
                      <span
                        className="workflows-table__description-text"
                        title={workflow.description}
                      >
                        {workflow.description || "—"}
                      </span>
                    </td>

                    {/* Status Badge */}
                    <td className="workflows-table__td--status">
                      <span
                        className={`workflow-status-badge workflow-status-badge--${workflow.status.toLowerCase()}`}
                      >
                        <span
                          className="workflow-status-badge__dot"
                          aria-hidden="true"
                        />
                        {workflow.status}
                      </span>
                    </td>

                    {/* Version */}
                    <td className="workflows-table__td--version">
                      <span className="workflow-version-badge">
                        v{workflow.version}
                      </span>
                    </td>

                    {/* Last Updated */}
                    <td className="workflows-table__td--updated">
                      {formatDisplayDate(workflow.updatedAt)}
                    </td>

                    {/* Actions */}
                    <td className="workflows-table__td--actions">
                      <div className="workflows-action-group">
                        {canEdit && (
                          <button
                            type="button"
                            className="workflows-row-btn workflows-row-btn--edit"
                            onClick={() =>
                              onEditWorkflow?.(
                                String(workflow.id),
                                workflow.graph!,
                              )
                            }
                            aria-label={`Edit workflow: ${workflow.name}`}
                            title="Edit in workflow studio"
                          >
                            Edit
                          </button>
                        )}

                        {canRun && (
                          <button
                            type="button"
                            className="workflows-row-btn workflows-row-btn--run"
                            onClick={() => void handleRunWorkflow(workflow)}
                            disabled={isRunButtonDisabled(canRun, isRunning)}
                            aria-label={`Run workflow: ${workflow.name}`}
                            title="Run execution"
                          >
                            {isRunning ? "Running…" : "Run"}
                          </button>
                        )}

                        {workflow.isPersisted && workflow.graph && (
                          <button
                            type="button"
                            className="workflows-row-btn workflows-row-btn--duplicate"
                            onClick={() => void handleDuplicateWorkflow(workflow)}
                            disabled={isDuplicating}
                            aria-label={`Duplicate workflow: ${workflow.name}`}
                            title="Duplicate this workflow"
                          >
                            {isDuplicating ? "Copying…" : "Duplicate"}
                          </button>
                        )}

                        {workflow.isPersisted && workflow.status === "Draft" && (
                          <button
                            type="button"
                            className="workflows-row-btn workflows-row-btn--activate"
                            onClick={() => void handleActivateWorkflow(workflow)}
                            disabled={isActivating}
                            aria-label={`Activate workflow: ${workflow.name}`}
                            title="Activate workflow"
                          >
                            {isActivating ? "…" : "Activate"}
                          </button>
                        )}

                        {workflow.isPersisted && workflow.status === "Active" && (
                          <button
                            type="button"
                            className="workflows-row-btn workflows-row-btn--pause"
                            onClick={() => void handlePauseWorkflow(workflow)}
                            disabled={isPausing}
                            aria-label={`Pause workflow: ${workflow.name}`}
                            title="Pause workflow"
                          >
                            {isPausing ? "…" : "Pause"}
                          </button>
                        )}

                        {workflow.isPersisted && workflow.status === "Paused" && (
                          <button
                            type="button"
                            className="workflows-row-btn workflows-row-btn--resume"
                            onClick={() => void handleResumeWorkflow(workflow)}
                            disabled={isResuming}
                            aria-label={`Resume workflow: ${workflow.name}`}
                            title="Resume workflow"
                          >
                            {isResuming ? "…" : "Resume"}
                          </button>
                        )}

                        {workflow.isPersisted && (
                          <button
                            type="button"
                            className="workflows-row-btn workflows-row-btn--delete"
                            onClick={() => openDeleteDialog(workflow)}
                            disabled={isDeleting}
                            aria-label={`Delete workflow: ${workflow.name}`}
                            title="Delete workflow"
                          >
                            {isDeleting ? "…" : "Delete"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* Grid / Card View */
        <div className="workflows-page__list">
          {sortedAndFilteredWorkflows.map((workflow) => (
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
              onEdit={
                workflow.isPersisted && workflow.graph && onEditWorkflow
                  ? () => onEditWorkflow(String(workflow.id), workflow.graph!)
                  : undefined
              }
              onDuplicate={
                workflow.isPersisted && workflow.graph
                  ? () => void handleDuplicateWorkflow(workflow)
                  : undefined
              }
              isDuplicating={duplicatingWorkflowId === String(workflow.id)}
              onActivate={
                workflow.isPersisted && workflow.status === "Draft"
                  ? () => void handleActivateWorkflow(workflow)
                  : undefined
              }
              isActivating={activatingWorkflowId === String(workflow.id)}
              onPause={
                workflow.isPersisted && workflow.status === "Active"
                  ? () => void handlePauseWorkflow(workflow)
                  : undefined
              }
              isPausing={pausingWorkflowId === String(workflow.id)}
              onResume={
                workflow.isPersisted && workflow.status === "Paused"
                  ? () => void handleResumeWorkflow(workflow)
                  : undefined
              }
              isResuming={resumingWorkflowId === String(workflow.id)}
              onDelete={
                workflow.isPersisted
                  ? () => openDeleteDialog(workflow)
                  : undefined
              }
              isDeleting={deletingWorkflowId === String(workflow.id)}
              canRun={workflow.isPersisted}
              isRunning={runningWorkflowId === String(workflow.id)}
              onRun={() => void handleRunWorkflow(workflow)}
            />
          ))}
        </div>
      )}

      {/* 7. Create Workflow Modal Dialog */}
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
                  className="workflows-page__btn workflows-page__btn--secondary"
                  onClick={closeCreateModal}
                  disabled={isSaving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="workflows-page__btn workflows-page__btn--primary"
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

      {/* 8. Confirm Delete Dialog */}
      <ConfirmDeleteDialog
        isOpen={Boolean(workflowToDelete)}
        workflowName={workflowToDelete?.name ?? ""}
        isDeleting={Boolean(deletingWorkflowId)}
        errorMessage={deleteError}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={closeDeleteDialog}
      />
    </div>
  );
}

export default WorkflowsPage;
