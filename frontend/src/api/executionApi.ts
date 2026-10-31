const API_BASE_URL = (
  (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL || "http://localhost:3000"
).replace(/\/+$/, "");


export type ExecutionWebSocketTicket = {
  ticket: string;
  expiresAt: string;
};

export async function createExecutionWsTicket(
  apiKey: string,
): Promise<ExecutionWebSocketTicket> {
  if (!apiKey.trim()) {
    throw new Error("API authentication is not configured.");
  }

  const response = await fetch(
    `${API_BASE_URL}/api/executions/ws-ticket`,
    {
      method: "POST",
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
        `WebSocket ticket request failed (HTTP ${response.status}).`,
    );
  }

  const payload = body as {
    ticket?: unknown;
    expiresAt?: unknown;
  } | null;

  if (
    typeof payload?.ticket !== "string" ||
    !payload.ticket.trim() ||
    typeof payload.expiresAt !== "string" ||
    Number.isNaN(Date.parse(payload.expiresAt)) ||
    Date.parse(payload.expiresAt) <= Date.now()
  ) {
    throw new Error("The API returned an invalid WebSocket ticket.");
  }

  return {
    ticket: payload.ticket,
    expiresAt: payload.expiresAt,
  };
}

export function getExecutionWebSocketUrl(ticket: string): string {
  const url = new URL(API_BASE_URL);

  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/executions";
  url.search = "";
  url.searchParams.set("ticket", ticket);

  return url.toString();
}
export type ExecutionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "compensating"
  | "compensated"
  | "compensation_failed";

export type CompensationStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export type ExecutionError = {
  code?: string;
  message?: string;
};

export type ExecutionCompensation = {
  status: CompensationStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: ExecutionError | null;
};

export type ExecutionNodeResult = {
  nodeId: string;
  status: "completed" | "failed" | "skipped";
  output?: unknown;
  error?: ExecutionError | string;
  compensation?: ExecutionCompensation;
};

export type WorkflowExecution = {
  id?: string;
  _id?: string;
  workflowId: string;
  workflowVersion?: number;
  status: ExecutionStatus;
  currentNodeId?: string | null;
  nodeResults?: ExecutionNodeResult[];
  error?: ExecutionError | string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string;
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