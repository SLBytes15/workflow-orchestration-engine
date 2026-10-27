import { Types } from "mongoose";

export const APPROVED_EVENT_SOURCE = "business_events" as const;

export interface EventTriggerConfig {
  kind: "event";
  source: typeof APPROVED_EVENT_SOURCE | string;
  eventName: string;
  filter?: Record<string, unknown>;
}

export interface BusinessEventDocument {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  eventName: string;
  payload: Record<string, unknown>;
}

export interface ExecutionEventEnvelope {
  eventId: string;
  eventName: string;
  source: typeof APPROVED_EVENT_SOURCE;
  payload: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidObjectId(value: unknown): boolean {
  if (value instanceof Types.ObjectId) {
    return true;
  }
  return typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
}

function toObjectId(value: unknown): Types.ObjectId {
  if (value instanceof Types.ObjectId) {
    return value;
  }
  return new Types.ObjectId(String(value));
}

const FORBIDDEN_FILTER_SEGMENTS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

/**
 * Validates an event-trigger configuration against the approved contract.
 */
export function validateEventTriggerConfig(config: unknown): string[] {
  const errors: string[] = [];

  if (!isRecord(config)) {
    return ["Trigger configuration must be an object"];
  }

  if (config.kind !== "event") {
    return ["Trigger config kind must be 'event'"];
  }

  if (typeof config.source !== "string" || !config.source.trim()) {
    errors.push("Event trigger source must be a non-empty string");
  } else if (config.source !== APPROVED_EVENT_SOURCE) {
    errors.push(
      `Event trigger source must be '${APPROVED_EVENT_SOURCE}' (got '${config.source}')`,
    );
  }

  if (typeof config.eventName !== "string" || !config.eventName.trim()) {
    errors.push("Event trigger eventName must be a non-empty string");
  }

  if (config.filter !== undefined) {
    if (!isRecord(config.filter)) {
      errors.push("Event trigger filter must be an object of key-value pairs");
    } else {
      const filterKeys = Object.keys(config.filter);
      for (const key of filterKeys) {
        if (key.startsWith("$")) {
          errors.push(
            `Filter key '${key}' cannot use MongoDB operator syntax`,
          );
          continue;
        }

        if (key === "tenantId" || key === "payload.tenantId") {
          errors.push(
            "Filter cannot target tenantId; tenant isolation is strictly enforced by the server",
          );
          continue;
        }

        if (!key.startsWith("payload.")) {
          errors.push(
            `Filter key '${key}' must target payload fields (e.g. 'payload.status')`,
          );
          continue;
        }

        const segments = key.split(".");
        if (segments.some((segment) => FORBIDDEN_FILTER_SEGMENTS.has(segment))) {
          errors.push(`Filter key '${key}' contains forbidden property segments`);
          continue;
        }

        const value = config.filter[key];
        const isPrimitive =
          value === null ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean";

        if (!isPrimitive) {
          errors.push(
            `Filter value for '${key}' must be a scalar equality primitive (string, number, boolean, null)`,
          );
        }
      }
    }
  }

  return errors;
}

/**
 * Validates all trigger nodes within a workflow graph.
 * If a trigger has kind === "event", it validates it against the approved contract.
 */
export function validateTriggerConfigurations(graph: unknown): string[] {
  if (!isRecord(graph) || !Array.isArray(graph.nodes)) {
    return ["Graph nodes must be an array"];
  }

  const errors: string[] = [];

  graph.nodes.forEach((node: unknown, index: number) => {
    if (!isRecord(node) || node.type !== "trigger" || !isRecord(node.data)) {
      return;
    }

    const config = node.data.config;
    if (config === undefined || config === null) {
      // Config is optional in generic canvas representation
      return;
    }

    if (isRecord(config) && config.kind === "event") {
      const configErrors = validateEventTriggerConfig(config);
      errors.push(
        ...configErrors.map((err) => `nodes[${index}].data.config: ${err}`),
      );
    }
  });

  return errors;
}

/**
 * Validates an incoming business event document (e.g., from Change Stream or ingestion).
 */
export function validateBusinessEventDocument(input: unknown): {
  valid: boolean;
  errors: string[];
  event?: BusinessEventDocument;
} {
  const errors: string[] = [];

  if (!isRecord(input)) {
    return { valid: false, errors: ["Event document must be a JSON object"] };
  }

  if (!isValidObjectId(input._id)) {
    errors.push("_id must be a valid MongoDB ObjectId");
  }

  if (!isValidObjectId(input.tenantId)) {
    errors.push("tenantId must be a valid top-level MongoDB ObjectId");
  }

  if (typeof input.eventName !== "string" || !input.eventName.trim()) {
    errors.push("eventName is required and must be a non-empty string");
  }

  let payload: Record<string, unknown> = {};
  if (input.payload !== undefined) {
    if (!isRecord(input.payload)) {
      errors.push("payload must be an object");
    } else {
      payload = { ...input.payload };
    }
  }

  // Ensure internal metadata fields cannot be spoofed or relied on inside payload
  delete payload._id;
  delete payload.tenantId;

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    event: {
      _id: toObjectId(input._id),
      tenantId: toObjectId(input.tenantId),
      eventName: (input.eventName as string).trim(),
      payload,
    },
  };
}

/**
 * Resolves a nested dot-notation property path on an object safely.
 */
function resolvePayloadPath(
  target: Record<string, unknown>,
  path: string,
): { found: boolean; value?: unknown } {
  const segments = path.split(".");
  let current: unknown = target;

  for (const segment of segments) {
    if (
      !isRecord(current) ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return { found: false };
    }
    current = current[segment];
  }

  return { found: true, value: current };
}

/**
 * Evaluates whether an event document matches the trigger filter.
 * Supports exact equality on permitted payload paths (e.g., "payload.status": "pending").
 */
export function matchEventFilter(
  filter: Record<string, unknown> | undefined,
  event: BusinessEventDocument,
): boolean {
  if (!filter || Object.keys(filter).length === 0) {
    return true;
  }

  for (const [key, expectedValue] of Object.entries(filter)) {
    // Only permitted payload paths are evaluated
    if (!key.startsWith("payload.")) {
      return false;
    }

    const payloadPath = key.slice("payload.".length);
    const resolved = resolvePayloadPath(event.payload, payloadPath);

    if (!resolved.found) {
      return false;
    }

    if (resolved.value !== expectedValue) {
      return false;
    }
  }

  return true;
}

/**
 * Builds the approved execution input envelope from a valid business event.
 */
export function buildExecutionEventEnvelope(
  event: BusinessEventDocument,
): ExecutionEventEnvelope {
  return {
    eventId: event._id.toString(),
    eventName: event.eventName,
    source: APPROVED_EVENT_SOURCE,
    payload: { ...event.payload },
  };
}

