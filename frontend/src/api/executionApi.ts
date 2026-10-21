const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000"
).replace(/\/+$/, "");

export type ExecutionStatus = "queued" | "running" | "completed" | "failed";

export type ExecutionNodeResult = {
  nodeId: string;
  status: "completed" | "failed" | "skipped";
  output?: unknown;
  error?:
    | {
        code?: string;
        message?: string;
      }
    | string;
};

export type WorkflowExecution = {
  id?: string;
  _id?: string;
  workflowId: string;
  workflowVersion?: number;
  status: ExecutionStatus;
  currentNodeId?: string | null;
  nodeResults?: ExecutionNodeResult[];
  error?:
    | {
        code?: string;
        message?: string;
      }
    | string
    | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
};


export async function startExecution(
  workflowId: string,
  apiKey: string,
  input: Record<string, unknown> = {},
): Promise<WorkflowExecution> {
  if (!apiKey.trim()) {
    throw new Error("API authentication is not configured.");
  }

  const response = await fetch(
    `${API_BASE_URL}/api/workflows/${encodeURIComponent(workflowId)}/executions`,
    {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input }),
    },
  );

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const payload = body as {
      error?: { message?: string; code?: string };
    } | null;

    throw new Error(
      payload?.error?.message ||
        `Execution request failed (HTTP ${response.status}).`,
    );
  }

  const payload = body as {
    execution?: WorkflowExecution;
    id?: string;
    _id?: string;
    workflowId?: string;
    status?: ExecutionStatus;
  } | null;

  const execution = payload?.execution ?? payload;

  if (!execution?.status || !execution.workflowId) {
    throw new Error(
      "The API response did not contain a valid execution result.",
    );
  }

  return execution as WorkflowExecution;
}


export async function getExecution(
  executionId: string,
  apiKey: string,
): Promise<WorkflowExecution> {
  if (!apiKey.trim()) {
    throw new Error("API authentication is not configured.");
  }

  const response = await fetch(
    `${API_BASE_URL}/api/executions/${encodeURIComponent(executionId)}`,
    {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
      },
    },
  );

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const payload = body as {
      error?: { message?: string };
    } | null;

    throw new Error(
      payload?.error?.message ||
        `Execution request failed (HTTP ${response.status}).`,
    );
  }

  const payload = body as {
    execution?: WorkflowExecution;
    id?: string;
    _id?: string;
    workflowId?: string;
    status?: ExecutionStatus;
  } | null;

  const execution = payload?.execution ?? payload;

  if (!execution?.status || !execution.workflowId) {
    throw new Error(
      "The API response did not contain a valid execution result.",
    );
  }

  return execution as WorkflowExecution;
}


export type WorkflowExecutionHistory = {
  executions: WorkflowExecution[];
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
};

export async function getWorkflowExecutions(
  workflowId: string,
  apiKey: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<WorkflowExecutionHistory> {
  if (!apiKey.trim()) {
    throw new Error("API authentication is not configured.");
  }

  const params = new URLSearchParams();

  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }

  if (options.cursor) {
    params.set("cursor", options.cursor);
  }

  const query = params.toString();
  const url =
    `${API_BASE_URL}/api/workflows/${encodeURIComponent(workflowId)}/executions` +
    (query ? `?${query}` : "");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-API-Key": apiKey,
    },
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const payload = body as {
      error?: { message?: string };
    } | null;

    throw new Error(
      payload?.error?.message ||
        `Execution history request failed (HTTP ${response.status}).`,
    );
  }

  const payload = body as WorkflowExecutionHistory;

  if (!payload || !Array.isArray(payload.executions) || !payload.pagination) {
    throw new Error(
      "The API response did not contain valid execution history.",
    );
  }

  return payload;
}


