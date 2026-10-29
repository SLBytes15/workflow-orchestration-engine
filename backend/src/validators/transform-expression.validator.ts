export type TransformJsonValue =
  | null
  | boolean
  | number
  | string
  | TransformJsonValue[]
  | { [key: string]: TransformJsonValue };

export type TransformExpression =
  | { operation: "constant"; value: TransformJsonValue }
  | { operation: "get"; path: Array<string | number> }
  | {
      operation: "object";
      fields: Record<string, TransformExpression>;
    };

export type TransformExpressionErrorCode =
  | "MALFORMED_EXPRESSION"
  | "UNSUPPORTED_VERSION"
  | "UNSUPPORTED_OPERATION"
  | "INVALID_EXPRESSION"
  | "LIMIT_EXCEEDED";

export type TransformExpressionValidation =
  | { ok: true; expression: TransformExpression }
  | {
      ok: false;
      error: {
        code: TransformExpressionErrorCode;
        message: string;
      };
    };

export const MAX_TRANSFORM_EXPRESSION_BYTES = 8 * 1024;
export const MAX_TRANSFORM_EXPRESSION_DEPTH = 32;
export const MAX_TRANSFORM_EXPRESSION_NODES = 256;
export const MAX_TRANSFORM_JSON_NESTING_DEPTH = 32;

const MAX_PARSER_NESTING_DEPTH = 256;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

class ExpressionParseError extends Error {}

class DuplicateKeyError extends ExpressionParseError {}

class ExpressionJsonParser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): unknown {
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      throw new ExpressionParseError();
    }
    return value;
  }

  private parseValue(parentDepth: number): unknown {
    this.skipWhitespace();
    const character = this.source[this.index];

    if (character === "{") {
      return this.parseObject(parentDepth + 1);
    }
    if (character === "[") {
      return this.parseArray(parentDepth + 1);
    }
    if (character === '"') {
      return this.parseString();
    }
    if (character === "t" && this.consumeLiteral("true")) {
      return true;
    }
    if (character === "f" && this.consumeLiteral("false")) {
      return false;
    }
    if (character === "n" && this.consumeLiteral("null")) {
      return null;
    }
    return this.parseNumber();
  }

  private parseObject(depth: number): Record<string, unknown> {
    this.ensureParserDepth(depth);
    this.index += 1;
    this.skipWhitespace();

    const result: Record<string, unknown> = {};
    const keys = new Set<string>();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return result;
    }

    while (true) {
      this.skipWhitespace();
      if (this.source[this.index] !== '"') {
        throw new ExpressionParseError();
      }

      const key = this.parseString();
      if (DANGEROUS_KEYS.has(key)) {
        throw new ExpressionParseError();
      }
      if (keys.has(key)) {
        throw new DuplicateKeyError();
      }
      keys.add(key);

      this.skipWhitespace();
      if (this.source[this.index] !== ":") {
        throw new ExpressionParseError();
      }
      this.index += 1;

      const value = this.parseValue(depth);
      Object.defineProperty(result, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });

      this.skipWhitespace();
      if (this.source[this.index] === "}") {
        this.index += 1;
        return result;
      }
      if (this.source[this.index] !== ",") {
        throw new ExpressionParseError();
      }
      this.index += 1;
    }
  }

  private parseArray(depth: number): unknown[] {
    this.ensureParserDepth(depth);
    this.index += 1;
    this.skipWhitespace();

    const result: unknown[] = [];
    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }

    while (true) {
      result.push(this.parseValue(depth));
      this.skipWhitespace();
      if (this.source[this.index] === "]") {
        this.index += 1;
        return result;
      }
      if (this.source[this.index] !== ",") {
        throw new ExpressionParseError();
      }
      this.index += 1;
    }
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;

    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === '"') {
        this.index += 1;
        try {
          const parsed: unknown = JSON.parse(this.source.slice(start, this.index));
          if (typeof parsed !== "string") {
            throw new ExpressionParseError();
          }
          return parsed;
        } catch (error) {
          if (error instanceof ExpressionParseError) {
            throw error;
          }
          throw new ExpressionParseError();
        }
      }

      if (character === "\\") {
        this.index += 2;
      } else {
        this.index += 1;
      }
    }

    throw new ExpressionParseError();
  }

  private parseNumber(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.source.slice(this.index),
    );
    if (!match) {
      throw new ExpressionParseError();
    }

    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) {
      throw new ExpressionParseError();
    }
    return Object.is(value, -0) ? 0 : value;
  }

  private consumeLiteral(literal: string): boolean {
    if (!this.source.startsWith(literal, this.index)) {
      return false;
    }
    this.index += literal.length;
    return true;
  }

  private skipWhitespace(): void {
    while (
      this.source[this.index] === " " ||
      this.source[this.index] === "\t" ||
      this.source[this.index] === "\r" ||
      this.source[this.index] === "\n"
    ) {
      this.index += 1;
    }
  }

  private ensureParserDepth(depth: number): void {
    if (depth > MAX_PARSER_NESTING_DEPTH) {
      throw new ExpressionParseError();
    }
  }
}

function failure(
  code: TransformExpressionErrorCode,
  message: string,
): TransformExpressionValidation {
  return { ok: false, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function normalizeJsonValue(
  value: unknown,
  parentDepth = 0,
): TransformJsonValue | null {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
  }

  if (Array.isArray(value)) {
    const depth = parentDepth + 1;
    if (depth > MAX_TRANSFORM_JSON_NESTING_DEPTH) {
      return null;
    }
    const normalized: TransformJsonValue[] = [];
    for (const item of value) {
      const result = normalizeJsonValue(item, depth);
      if (result === null && item !== null) {
        return null;
      }
      normalized.push(result);
    }
    return normalized;
  }

  if (isRecord(value)) {
    const depth = parentDepth + 1;
    if (depth > MAX_TRANSFORM_JSON_NESTING_DEPTH) {
      return null;
    }
    const normalized: Record<string, TransformJsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (DANGEROUS_KEYS.has(key)) {
        return null;
      }
      const result = normalizeJsonValue(item, depth);
      if (result === null && item !== null) {
        return null;
      }
      Object.defineProperty(normalized, key, {
        value: result,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return normalized;
  }

  return null;
}

function validateNode(
  value: unknown,
  depth: number,
  count: { value: number },
): TransformExpressionValidation {
  if (depth > MAX_TRANSFORM_EXPRESSION_DEPTH) {
    return failure("LIMIT_EXCEEDED", "Expression depth limit exceeded.");
  }
  count.value += 1;
  if (count.value > MAX_TRANSFORM_EXPRESSION_NODES) {
    return failure("LIMIT_EXCEEDED", "Expression node limit exceeded.");
  }
  if (!isRecord(value) || typeof value.operation !== "string") {
    return failure("INVALID_EXPRESSION", "Expression node is invalid.");
  }

  if (value.operation === "constant") {
    if (!hasExactKeys(value, ["operation", "value"])) {
      return failure("INVALID_EXPRESSION", "Constant expression is invalid.");
    }
    const normalized = normalizeJsonValue(value.value);
    if (normalized === null && value.value !== null) {
      const nestedLimit = containsJsonNestingLimit(value.value);
      return nestedLimit
        ? failure("LIMIT_EXCEEDED", "JSON nesting depth limit exceeded.")
        : failure("INVALID_EXPRESSION", "Constant value is not valid JSON.");
    }
    return { ok: true, expression: { operation: "constant", value: normalized } };
  }

  if (value.operation === "get") {
    if (
      !hasExactKeys(value, ["operation", "path"]) ||
      !Array.isArray(value.path) ||
      !value.path.every(
        (segment) =>
          (typeof segment === "string" && !DANGEROUS_KEYS.has(segment)) ||
          (typeof segment === "number" &&
            Number.isSafeInteger(segment) &&
            segment >= 0),
      )
    ) {
      return failure("INVALID_EXPRESSION", "Get expression path is invalid.");
    }
    return {
      ok: true,
      expression: {
        operation: "get",
        path: value.path as Array<string | number>,
      },
    };
  }

  if (value.operation === "object") {
    if (
      !hasExactKeys(value, ["operation", "fields"]) ||
      !isRecord(value.fields)
    ) {
      return failure("INVALID_EXPRESSION", "Object expression is invalid.");
    }

    const fields: Record<string, TransformExpression> = {};
    for (const [key, child] of Object.entries(value.fields)) {
      if (DANGEROUS_KEYS.has(key)) {
        return failure("INVALID_EXPRESSION", "Object field name is invalid.");
      }
      const childResult = validateNode(child, depth + 1, count);
      if (!childResult.ok) {
        return childResult;
      }
      Object.defineProperty(fields, key, {
        value: childResult.expression,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return { ok: true, expression: { operation: "object", fields } };
  }

  return failure("UNSUPPORTED_OPERATION", "Expression operation is unsupported.");
}

function containsJsonNestingLimit(value: unknown): boolean {
  const pending: Array<{ value: unknown; parentDepth: number }> = [
    { value, parentDepth: 0 },
  ];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    if (Array.isArray(current.value)) {
      const depth = current.parentDepth + 1;
      if (depth > MAX_TRANSFORM_JSON_NESTING_DEPTH) {
        return true;
      }
      for (const item of current.value) {
        pending.push({ value: item, parentDepth: depth });
      }
    } else if (isRecord(current.value)) {
      const depth = current.parentDepth + 1;
      if (depth > MAX_TRANSFORM_JSON_NESTING_DEPTH) {
        return true;
      }
      for (const item of Object.values(current.value)) {
        pending.push({ value: item, parentDepth: depth });
      }
    }
  }
  return false;
}

export function validateTransformExpression(
  source: string,
): TransformExpressionValidation {
  if (typeof source !== "string") {
    return failure("MALFORMED_EXPRESSION", "Expression must be a string.");
  }
  if (new TextEncoder().encode(source).byteLength > MAX_TRANSFORM_EXPRESSION_BYTES) {
    return failure("LIMIT_EXCEEDED", "Expression size limit exceeded.");
  }

  let document: unknown;
  try {
    document = new ExpressionJsonParser(source).parse();
  } catch (error) {
    if (error instanceof DuplicateKeyError) {
      return failure("INVALID_EXPRESSION", "Expression contains a duplicate key.");
    }
    if (error instanceof ExpressionParseError) {
      return failure("MALFORMED_EXPRESSION", "Expression JSON is malformed.");
    }
    throw error;
  }

  if (!isRecord(document)) {
    return failure("INVALID_EXPRESSION", "Expression document must be an object.");
  }
  if (!Object.hasOwn(document, "version")) {
    return failure("INVALID_EXPRESSION", "Expression version is required.");
  }
  if (document.version !== 1) {
    return failure("UNSUPPORTED_VERSION", "Expression version is unsupported.");
  }
  if (
    !hasExactKeys(document, ["version", "expression"]) ||
    !Object.hasOwn(document, "expression")
  ) {
    return failure("INVALID_EXPRESSION", "Expression document is invalid.");
  }

  return validateNode(document.expression, 1, { value: 0 });
}
