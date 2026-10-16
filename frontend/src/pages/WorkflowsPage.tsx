import { useEffect, useState, type FormEvent } from "react";
import WorkflowCard from "../components/workflows/WorkflowCard";
import WorkflowListState from "../components/workflows/WorkflowListState";
import "./WorkflowsPage.css";
c

function toWorkflowStatus(status?: string): WorkflowStatus {
  switch (status?.toLowerCase()) {
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    default:
      return "Draft";
  }
}

function getErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;

  const record = body as ApiErrorBody;
  const error = record.error;

  if (typeof error === "string") return error;

  if (typeof error === "object" && error !== null) {
    if (typeof error.message === "string") return error.message;

    if (Array.isArray(error.errors)) {
      return error.errors
        .filter((item): item is string => typeof item === "string")
        .join(", ");
    }
  }

  if (typeof record.message === "string") return record.message;

  if (Array.isArray(record.errors)) {
    return record.errors
      .filter((item): item is string => typeof item === "string")
      .join(", ");
  }

  return fallback;
}

function mapApiWorkflow(item: ApiWorkflow): Workflow {
  const id = item._id || item.id;

  if (!id || typeof item.name !== "string") {
    throw new Error("The server returned a workflow with missing required fields.");
  }

  const date = item.updatedAt || item.createdAt || "";

  return {
    id,
    name: item.name,
    description: item.description || "No description provided.",
    status: toWorkflowStatus(item.status),
    version: item.version ?? 1,
    updatedAt: date ? date.slice(0, 10) : "Unknown",
  };
}

function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadWorkflows() {
      setIsLoading(true);
      setLoadError("");

      try {
        if (!API_KEY) {
          throw new Error(
            "Development API key is not configured. Check frontend/.env.local.",
          );
        }

        const response = await fetch(`${API_BASE_URL}/api/workflows`, {
          method: "GET",
          headers: { "x-api-key": API_KEY },
          signal: controller.signal,
        });

        const body: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            getErrorMessage(
              body,
              `Could not load workflows (HTTP ${response.status}).`,
            ),
          );
        }

        if (typeof body !== "object" || body === null) {
          throw new Error("The server returned an unexpected response.");
        }

        const result = body as { workflows?: unknown };

        if (!Array.isArray(result.workflows)) {
          throw new Error("The server response did not contain a workflow list.");
        }

        setWorkflows(
          result.workflows.map((item: unknown) => {
            if (typeof item !== "object" || item === null) {
              throw new Error("The server returned an invalid workflow.");
            }
            return mapApiWorkflow(item as ApiWorkflow);
          }),
        );
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;

        setLoadError(
          error instanceof Error ? error.message : "Could not load workflows.",
        );
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void loadWorkflows();

    return () => controller.abort();
  }, []);

  const filteredWorkflows = workflows.filter((workflow) => {
    const query = search.toLowerCase();
    const matchesSearch =
      workflow.name.toLowerCase().includes(query) ||
      workflow.description.toLowerCase().includes(query);

    const matchesStatus =
      statusFilter === "All" || workflow.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  async function handleCreateWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setSuccessMessage("");

    if (!API_KEY) {
      setFormError(
        "Development API key is not configured. Check frontend/.env.local.",
      );
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();

    if (!name) {
      setFormError("Workflow name is required.");
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/workflows`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
        },
        body: JSON.stringify({
          name,
          description,
          graph: createInitialGraph(),
        }),
      });

      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          getErrorMessage(
            body,
            `Could not create workflow (HTTP ${response.status}).`,
          ),
        );
      }

      if (typeof body !== "object" || body === null) {
        throw new Error("The server returned an unexpected response.");
      }

      const record = body as { workflow?: unknown };

      if (typeof record.workflow !== "object" || record.workflow === null) {
        throw new Error("The server response did not contain the created workflow.");
      }

      const createdWorkflow = mapApiWorkflow(record.workflow as ApiWorkflow);

      setWorkflows((current) => [
        createdWorkflow,
        ...current.filter((workflow) => workflow.id !== createdWorkflow.id),
      ]);
      setSearch("");
      setStatusFilter("All");
      form.reset();
      setSuccessMessage("Workflow saved successfully.");
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while saving the workflow.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  useEffect(() => {
    if (!isCreateOpen) return

    nameInputRef.current?.focus()

    function handleModalKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeCreateModal()
        return
      }

      if (event.key !== 'Tab' || !modalRef.current) return

      const focusableElements =
        modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )

      if (focusableElements.length === 0) return

      const firstElement = focusableElements[0]
      const lastElement =
        focusableElements[focusableElements.length - 1]

      if (
        event.shiftKey &&
        document.activeElement === firstElement
      ) {
        event.preventDefault()
        lastElement.focus()
      } else if (
        !event.shiftKey &&
        document.activeElement === lastElement
      ) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', handleModalKeyDown)

    return () => {
      document.removeEventListener('keydown', handleModalKeyDown)
    }
  }, [isCreateOpen, isSaving, closeCreateModal])

  async function handleCreateWorkflow(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    if (isSaving) return

    const trimmedName = name.trim()
    const trimmedDescription = description.trim()

    setNameError('')
    setApiError('')

    if (!trimmedName) {
      setNameError('Please enter a workflow name.')
      return
    }

    const duplicate = workflows.some(
      (workflow) =>
        workflow.name.toLowerCase() === trimmedName.toLowerCase(),
    )

    if (duplicate) {
      setNameError('A workflow with this name already exists.')
      return
    }

    if (!graph) {
      setApiError(
        'No workflow graph is available. Open Node Preview and prepare a graph before saving.',
      )
      return
    }

    if (!tenantApiKey?.trim()) {
      setApiError(
        'API authentication is not configured. Ask your team for the approved development API-key setup.',
      )
      return
    }

    setIsSaving(true)

    try {
      const result = await createWorkflow(
        {
          name: trimmedName,
          ...(trimmedDescription
            ? { description: trimmedDescription }
            : {}),
          graph,
        },
        tenantApiKey,
      )

      const savedWorkflow = result?.workflow

      if (!savedWorkflow) {
        throw new Error(
          'The backend response did not contain a saved workflow. Please verify the API response.',
        )
      }

      const newWorkflow: Workflow = {
        id: Date.now(),
        name: savedWorkflow.name ?? trimmedName,
        description:
          savedWorkflow.description ??
          trimmedDescription ??
          'No description provided.',
        status: savedWorkflow.status ?? 'Draft',
        version: savedWorkflow.version ?? 1,
        updatedAt: savedWorkflow.updatedAt
          ? String(savedWorkflow.updatedAt).slice(0, 10)
          : new Date().toISOString().slice(0, 10),
      }

      setWorkflows((current) => [...current, newWorkflow])
      setSearch('')
      setStatusFilter('All')
      setIsCreateOpen(false)
      setName('')
      setDescription('')
      setNameError('')
      setApiError('')

      window.setTimeout(() => createButtonRef.current?.focus(), 0)
    } catch (error) {
      setApiError(
        error instanceof Error
          ? error.message
          : 'Unable to save the workflow. Please try again.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="workflows-page">
      <header className="workflows-page__header">
        <div>
          <p className="workflows-page__eyebrow">
            WORKFLOW MANAGEMENT
          </p>
          <h1>Workflows</h1>
          <p>Build, search, and manage your workflow definitions.</p>
        </div>

        <button
          ref={createButtonRef}
          type="button"
          className="workflows-page__create"

          onClick={() => {
  setApiError('');
  setIsCreateOpen(true);
}}

        >
          <span aria-hidden="true">+</span> Create workflow
        </button>
      </header>

      <p className="workflows-page__demo-note">
        Sample workflows are displayed for demonstration. Workflows
        created through the form are added to this page only after the
        backend confirms a successful save. Existing sample workflows
        are not loaded from the backend.
      </p>

      <p className="workflows-page__note" role="status">
        {graph
          ? `Workflow graph available (${graph.nodes.length} nodes, ${graph.edges.length} edges).`
          : 'Open Node Preview to prepare a workflow graph.'}
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


      {loadError && (
  <p className="workflows-page__message" role="alert">
    {loadError}
  </p>
)}

<div className="workflows-page__results-heading">
  <h2>All workflows</h2>
  <span>{filteredWorkflows.length} shown</span>
</div>

{isLoading ? (
  <WorkflowListState loading={true} hasWorkflows={false} />
) : loadError ? null : workflows.length === 0 ? (
  <WorkflowListState loading={false} hasWorkflows={false} />
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
            />
          ))}
        </div>
      )}


      {!isLoading &&
  !loadError &&
  filteredWorkflows.length === 0 &&
  (search.trim() !== "" || statusFilter !== "All") && (
    <p className="workflows-page__message" role="status">
      No workflows match your search and selected status.
    </p>
  )}

{!isLoading && !loadError && workflows.length === 0 && (
  <p className="workflows-page__message" role="status">
    No workflows yet. Create your first workflow.
  </p>
)}
      <form className="workflows-page__form" onSubmit={handleCreateWorkflow}>
        <h2>Create a workflow</h2>

        <label htmlFor="workflow-name">Workflow name (required)</label>
        <input
          id="workflow-name"
          name="name"
          type="text"
          required
          maxLength={120}
          placeholder="Enter workflow name"
          disabled={isSaving}
        />

        <label htmlFor="workflow-description">Description (optional)</label>
        <textarea
          id="workflow-description"
          name="description"
          rows={3}
          maxLength={2000}
          placeholder="What does this workflow do?"
          disabled={isSaving}
        />

        <button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save workflow"}
        </button>

        {formError && (
          <p className="workflows-page__message" role="alert">
            {formError}
          </p>
        )}

        {successMessage && (
          <p className="workflows-page__message" role="status">
            {successMessage}
          </p>
        )}

        <p className="workflows-page__note">
          New workflows are saved through the backend with an initial trigger
          node. The list is loaded from the authenticated workflow API.
        </p>
      </form>

      {isCreateOpen && (
        <div
          className="workflows-page__modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !isSaving
            ) {
              closeCreateModal()
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
                <p className="workflows-page__eyebrow">
                  NEW DEFINITION
                </p>
                <h2 id="workflow-modal-title">Create workflow</h2>
                <p>
                  Give your workflow a name and an optional description.
                </p>
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
                <label htmlFor="workflow-name">
                  Workflow name *
                </label>
                <input
                  ref={nameInputRef}
                  id="workflow-name"
                  name="name"
                  type="text"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value)
                    if (nameError) setNameError('')
                    if (apiError) setApiError('')
                  }}
                  maxLength={100}
                  placeholder="e.g. Payment Processing"
                  aria-invalid={Boolean(nameError)}
                  aria-describedby={
                    nameError ? 'workflow-name-error' : undefined
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
                    setDescription(event.target.value)
                    if (apiError) setApiError('')
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
                  {isSaving ? 'Saving...' : 'Save workflow'}
                </button>
              </div>

              <p className="workflows-page__note">
                New workflows start in Draft status. Saving requires a
                valid graph and approved API authentication.
              </p>
            </form>
          </section>
        </div>
      )}

    </section>
  );
}

export default WorkflowsPage;
