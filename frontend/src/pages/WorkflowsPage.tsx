import { useEffect, useState, type FormEvent } from "react";
import WorkflowCard from "../components/workflows/WorkflowCard";
import WorkflowListState from "../components/workflows/WorkflowListState";
import "./WorkflowsPage.css";

type WorkflowStatus = "Active" | "Draft" | "Paused";

type Workflow = {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  version: number;
  updatedAt: string;
};

type ApiWorkflow = {
  _id?: string;
  id?: string;
  name: string;
  description?: string;
  status?: string;
  version?: number;
  updatedAt?: string;
  createdAt?: string;
};

type WorkflowGraph = {
  version: 1;
  nodes: {
    id: string;
    type: "trigger";
    position: { x: number; y: number };
    data: { type: "trigger"; label: string };
  }[];
  edges: { id: string; source: string; target: string }[];
};

type ApiErrorBody = {
  error?: string | { message?: string; errors?: unknown };
  message?: string;
  errors?: unknown;
};

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000"
).replace(/\/+$/, "");

const API_KEY = import.meta.env.VITE_API_KEY?.trim();

function createInitialGraph(): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 100, y: 100 },
        data: {
          type: "trigger",
          label: "Workflow started",
        },
      },
    ],
    edges: [],
  };
}

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

  return (
    <section className="workflows-page">
      <header className="workflows-page__header">
        <div>
          <h1>Workflows</h1>
          <p>Search, manage, and create your workflows.</p>
        </div>

        <button
          type="button"
          className="workflows-page__create"
          onClick={() => document.getElementById("workflow-name")?.focus()}
        >
          Create workflow
        </button>
      </header>

      <div className="workflows-page__filters">
        <label htmlFor="workflow-search">Search workflows</label>
        <input
          id="workflow-search"
          type="search"
          placeholder="Search by name or description..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

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

      {loadError && (
        <p className="workflows-page__message" role="alert">
          {loadError}
        </p>
      )}

      <WorkflowListState
        loading={isLoading}
        hasWorkflows={filteredWorkflows.length > 0}
      />

      {!isLoading && !loadError && filteredWorkflows.length > 0 && (
        <div className="workflows-page__list">
          {filteredWorkflows.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              name={workflow.name}
              description={`${workflow.description} Updated: ${workflow.updatedAt}`}
              status={workflow.status}
              version={workflow.version}
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
          No workflows yet. Create your first workflow below.
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
    </section>
  );
}

export default WorkflowsPage;
