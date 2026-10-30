import {
  validateTransformExpression,
  type TransformExpression,
  type TransformExpressionErrorCode,
  type TransformJsonValue,
} from "../validators/transform-expression.validator";

export type TransformEvaluationErrorCode =
  | TransformExpressionErrorCode
  | "INVALID_INPUT"
  | "MISSING_PATH"
  | "TYPE_MISMATCH";

export type TransformEvaluationResult =
  | { ok: true; value: TransformJsonValue }
  | {
      ok: false;
      error: {
        code: TransformEvaluationErrorCode;
        message: string;
      };
    };

const MAX_JSON_NESTING_DEPTH = 32;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

type JsonNormalization =
  | { ok: true; value: TransformJsonValue }
  | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeJsonValue(
  value: unknown,
  parentDepth = 0,
  ancestors = new Set<object>(),
): JsonNormalization {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return { ok: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { ok: true, value: Object.is(value, -0) ? 0 : value }
      : { ok: false };
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    return { ok: false };
  }

  const depth = parentDepth + 1;
  if (depth > MAX_JSON_NESTING_DEPTH) {
    return { ok: false };
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (
        keys.some(
          (key) =>
            key !== "length" &&
            (typeof key !== "string" ||
              !/^(0|[1-9]\d*)$/.test(key) ||
              Number(key) >= value.length),
        )
      ) {
        return { ok: false };
      }

      const normalized: TransformJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          return { ok: false };
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          return { ok: false };
        }
        const item = normalizeJsonValue(descriptor.value, depth, ancestors);
        if (!item.ok) {
          return { ok: false };
        }
        normalized.push(item.value);
      }
      return { ok: true, value: normalized };
    }

    if (!isRecord(value)) {
      return { ok: false };
    }
    const normalized: Record<string, TransformJsonValue> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || DANGEROUS_KEYS.has(key)) {
        return { ok: false };
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return { ok: false };
      }
      const item = normalizeJsonValue(descriptor.value, depth, ancestors);
      if (!item.ok) {
        return { ok: false };
      }
      Object.defineProperty(normalized, key, {
        value: item.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return { ok: true, value: normalized };
  } finally {
    ancestors.delete(value);
  }
}

function error(
  code: TransformEvaluationErrorCode,
  message: string,
): TransformEvaluationResult {
  return { ok: false, error: { code, message } };
}

function evaluateNode(
  expression: TransformExpression,
  input: Record<string, TransformJsonValue>,
): TransformEvaluationResult {
  if (expression.operation === "constant") {
    return { ok: true, value: expression.value };
  }

  if (expression.operation === "object") {
    const output: Record<string, TransformJsonValue> = {};
    for (const [key, child] of Object.entries(expression.fields)) {
      const result = evaluateNode(child, input);
      if (!result.ok) {
        return result;
      }
      Object.defineProperty(output, key, {
        value: result.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return { ok: true, value: output };
  }

  let current: TransformJsonValue = input;
  for (const segment of expression.path) {
    if (Array.isArray(current)) {
      if (typeof segment !== "number") {
        return error("TYPE_MISMATCH", "Path segment does not match an array.");
      }
      if (segment >= current.length || !Object.hasOwn(current, segment)) {
        return error("MISSING_PATH", "Path does not exist in the input.");
      }
      current = current[segment];
      continue;
    }
    if (typeof segment !== "string") {
      return error("TYPE_MISMATCH", "Path segment does not match an object.");
    }
    if (current === null || typeof current !== "object") {
      return error("TYPE_MISMATCH", "Path traverses a non-object value.");
    }
    if (!Object.hasOwn(current, segment)) {
      return error("MISSING_PATH", "Path does not exist in the input.");
    }
    current = (current as Record<string, TransformJsonValue>)[segment];
  }

  return { ok: true, value: current };
}

export function evaluateTransform(
  expression: string,
  input: Readonly<Record<string, unknown>>,
): TransformEvaluationResult {
  const validated = validateTransformExpression(expression);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  let normalizedInput: Record<string, TransformJsonValue>;
  try {
    if (!isRecord(input)) {
      return error("INVALID_INPUT", "Transformation input must be an object.");
    }
    const normalized = normalizeJsonValue(input);
    if (
      !normalized.ok ||
      normalized.value === null ||
      typeof normalized.value !== "object" ||
      Array.isArray(normalized.value)
    ) {
      return error("INVALID_INPUT", "Transformation input is not valid JSON.");
    }
    normalizedInput = normalized.value;
  } catch {
    return error("INVALID_INPUT", "Transformation input is not valid JSON.");
  }

  return evaluateNode(validated.expression, normalizedInput);
}
