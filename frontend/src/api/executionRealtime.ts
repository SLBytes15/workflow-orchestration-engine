import {
  createExecutionWsTicket,
  getExecutionWebSocketUrl,
  type ExecutionStatus,
} from "./executionApi";

export type ExecutionUpdateEvent = {
  type: "execution.updated" | "execution.completed" | "execution.failed";
  data: {
    executionId: string;
    workflowId: string;
    status: ExecutionStatus;
    updatedAt: string;
  };
};

const EXECUTION_STATUSES = new Set<ExecutionStatus>([
  "queued",
  "running",
  "completed",
  "failed",
  "compensating",
  "compensated",
  "compensation_failed",
]);

const EVENT_TYPES = new Set<ExecutionUpdateEvent["type"]>([
  "execution.updated",
  "execution.completed",
  "execution.failed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseExecutionUpdateEvent(
  raw: unknown,
): ExecutionUpdateEvent | null {
  let value: unknown = raw;

  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!isRecord(value) || !EVENT_TYPES.has(
    value.type as ExecutionUpdateEvent["type"],
  ) || !isRecord(value.data)) {
    return null;
  }

  const data = value.data;

  if (
    typeof data.executionId !== "string" ||
    !data.executionId.trim() ||
    typeof data.workflowId !== "string" ||
    !data.workflowId.trim() ||
    typeof data.status !== "string" ||
    !EXECUTION_STATUSES.has(data.status as ExecutionStatus) ||
    typeof data.updatedAt !== "string" ||
    Number.isNaN(Date.parse(data.updatedAt))
  ) {
    return null;
  }

  return {
    type: value.type as ExecutionUpdateEvent["type"],
    data: {
      executionId: data.executionId,
      workflowId: data.workflowId,
      status: data.status as ExecutionStatus,
      updatedAt: data.updatedAt,
    },
  };
}

type WebSocketLike = {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close: () => void;
};

export type RealtimeConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected";

export type RealtimeOptions = {
  apiKey: string;
  onEvent: (event: ExecutionUpdateEvent) => void;
  onReconnect: () => void;
  onStatusChange?: (status: RealtimeConnectionStatus) => void;
  webSocketFactory?: (url: string) => WebSocketLike;
  requestTicket?: typeof createExecutionWsTicket;
  buildUrl?: typeof getExecutionWebSocketUrl;
  schedule?: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
};

export function connectExecutionUpdates(
  options: RealtimeOptions,
): () => void {
  const requestTicket = options.requestTicket ?? createExecutionWsTicket;
  const buildUrl = options.buildUrl ?? getExecutionWebSocketUrl;
  const webSocketFactory =
    options.webSocketFactory ??
    ((url: string) => new WebSocket(url));

  const schedule =
    options.schedule ??
    ((callback, delay) => setTimeout(callback, delay));

  const cancel = options.cancel ?? ((timer) => clearTimeout(timer));

  let stopped = false;
  let connectedBefore = false;
  let reconnectAttempt = 0;
  let socket: WebSocketLike | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleReconnect() {
    if (stopped || reconnectTimer !== undefined) return;

    const delay = Math.min(
      1000 * 2 ** reconnectAttempt,
      30000,
    );

    reconnectAttempt += 1;

    reconnectTimer = schedule(() => {
      reconnectTimer = undefined;
      void connect();
    }, delay);
  }

  async function connect() {
    if (stopped) return;

    options.onStatusChange?.("connecting");

    try {
      // Every connection attempt obtains a fresh single-use ticket.
      const ticket = await requestTicket(options.apiKey);

      if (stopped) return;

      const expiresAt = Date.parse(ticket.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error("The WebSocket ticket has expired.");
      }

      const currentSocket = webSocketFactory(
        buildUrl(ticket.ticket),
      );

      socket = currentSocket;

      currentSocket.onopen = () => {
        if (stopped || socket !== currentSocket) return;

        const isReconnect = connectedBefore;
        connectedBefore = true;
        reconnectAttempt = 0;

        options.onStatusChange?.("connected");

        if (isReconnect) {
          options.onReconnect();
        }
      };

      currentSocket.onmessage = (message) => {
        if (stopped || socket !== currentSocket) return;

        const event = parseExecutionUpdateEvent(message.data);

        if (event) {
          options.onEvent(event);
        }
      };

      currentSocket.onclose = () => {
        if (stopped || socket !== currentSocket) return;

        socket = null;
        options.onStatusChange?.("disconnected");
        scheduleReconnect();
      };

      currentSocket.onerror = () => {
        if (stopped || socket !== currentSocket) return;

        currentSocket.close();
      };
    } catch {
      if (stopped) return;
      options.onStatusChange?.("disconnected");
      scheduleReconnect();
    }
  }

  void connect();

  return () => {
    stopped = true;

    if (reconnectTimer !== undefined) {
      cancel(reconnectTimer);
      reconnectTimer = undefined;
    }

    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
      socket = null;
    }

    options.onStatusChange?.("disconnected");
  };
}