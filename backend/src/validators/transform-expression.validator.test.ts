import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_TRANSFORM_EXPRESSION_BYTES,
  MAX_TRANSFORM_EXPRESSION_DEPTH,
  MAX_TRANSFORM_JSON_NESTING_DEPTH,
  validateTransformExpression,
} from "./transform-expression.validator";

function document(expression: unknown, version = 1): string {
  return JSON.stringify({ version, expression });
}

function constant(value: unknown): string {
  return document({ operation: "constant", value });
}

function expressionChain(depth: number): string {
  let expression: unknown = { operation: "constant", value: null };
  for (let index = 1; index < depth; index += 1) {
    expression = { operation: "object", fields: { child: expression } };
  }
  return document(expression);
}

function nestedArrays(depth: number): unknown {
  let value: unknown = null;
  for (let index = 0; index < depth; index += 1) {
    value = [value];
  }
  return value;
}

function sourceAtByteLength(byteLength: number): string {
  const prefix = '{"version":1,"expression":{"operation":"constant","value":"';
  const suffix = '"}}';
  const paddingLength = byteLength - prefix.length - suffix.length;
  assert.ok(paddingLength >= 0);
  return `${prefix}${"x".repeat(paddingLength)}${suffix}`;
}

describe("validateTransformExpression", () => {
  it("accepts the supported constant JSON categories", () => {
    for (const value of [
      null,
      true,
      "text",
      42,
      [null, false, "item", 1, { key: "value" }],
      { nested: { value: [1, 2] } },
    ]) {
      assert.equal(validateTransformExpression(constant(value)).ok, true);
    }
  });

  it("rejects malformed JSON and invalid JSON numbers", () => {
    for (const source of [
      '{"version":1,"expression":',
      '{"version":1,"expression":{"operation":"constant","value":1e400}}',
      '{"version":1,"expression":{"operation":"constant","value":01}}',
    ]) {
      assert.equal(validateTransformExpression(source).ok, false);
    }
  });

  it("requires version 1 and rejects unknown document and operation fields", () => {
    const unsupportedVersion = validateTransformExpression(document({}, 2));
    assert.equal(unsupportedVersion.ok, false);
    if (!unsupportedVersion.ok) {
      assert.equal(unsupportedVersion.error.code, "UNSUPPORTED_VERSION");
    }
    assert.equal(validateTransformExpression('{"expression":{}}').ok, false);
    assert.equal(
      validateTransformExpression(
        '{"version":1,"extra":true,"expression":{"operation":"constant","value":0}}',
      ).ok,
      false,
    );
    const unsupportedOperation = validateTransformExpression(
      document({ operation: "unknown", value: 1 }),
    );
    assert.equal(unsupportedOperation.ok, false);
    if (!unsupportedOperation.ok) {
      assert.equal(unsupportedOperation.error.code, "UNSUPPORTED_OPERATION");
    }
    assert.equal(
      validateTransformExpression(
        document({ operation: "constant", value: 1, extra: true }),
      ).ok,
      false,
    );
  });

  it("rejects duplicate and escaped-equivalent object keys", () => {
    for (const source of [
      '{"version":1,"expression":{"operation":"constant","value":{"a":1,"a":2}}}',
      '{"version":1,"expression":{"operation":"constant","value":{"a":1,"\\u0061":2}}}',
    ]) {
      const result = validateTransformExpression(source);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, "INVALID_EXPRESSION");
      }
    }
  });

  it("rejects dangerous keys throughout the expression document", () => {
    for (const source of [
      '{"version":1,"expression":{"operation":"constant","value":{"__proto__":1}}}',
      '{"version":1,"expression":{"operation":"object","fields":{"constructor":{"operation":"constant","value":1}}}}',
      '{"version":1,"expression":{"operation":"get","path":["prototype"]}}',
    ]) {
      assert.equal(validateTransformExpression(source).ok, false);
    }
  });

  it("validates get paths and permits an empty path", () => {
    assert.equal(
      validateTransformExpression(
        document({ operation: "get", path: [] }),
      ).ok,
      true,
    );
    for (const path of [[-1], [1.5], [true], [Number.MAX_SAFE_INTEGER + 1]]) {
      assert.equal(
        validateTransformExpression(document({ operation: "get", path })).ok,
        false,
      );
    }
  });

  it("accepts expression depth immediately below and at the limit, then rejects above", () => {
    assert.equal(
      validateTransformExpression(
        expressionChain(MAX_TRANSFORM_EXPRESSION_DEPTH - 1),
      ).ok,
      true,
    );
    assert.equal(
      validateTransformExpression(
        expressionChain(MAX_TRANSFORM_EXPRESSION_DEPTH),
      ).ok,
      true,
    );
    const result = validateTransformExpression(
      expressionChain(MAX_TRANSFORM_EXPRESSION_DEPTH + 1),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "LIMIT_EXCEEDED");
    }
  });

  it("accepts JSON nesting immediately below and at the limit, then rejects above", () => {
    for (const depth of [
      MAX_TRANSFORM_JSON_NESTING_DEPTH - 1,
      MAX_TRANSFORM_JSON_NESTING_DEPTH,
    ]) {
      assert.equal(
        validateTransformExpression(constant(nestedArrays(depth))).ok,
        true,
      );
    }
    const result = validateTransformExpression(
      constant(nestedArrays(MAX_TRANSFORM_JSON_NESTING_DEPTH + 1)),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "LIMIT_EXCEEDED");
    }
  });

  it("accepts expression sizes below and at 8 KiB, then rejects above", () => {
    assert.equal(
      validateTransformExpression(
        sourceAtByteLength(MAX_TRANSFORM_EXPRESSION_BYTES - 1),
      ).ok,
      true,
    );
    assert.equal(
      validateTransformExpression(
        sourceAtByteLength(MAX_TRANSFORM_EXPRESSION_BYTES),
      ).ok,
      true,
    );
    const result = validateTransformExpression(
      sourceAtByteLength(MAX_TRANSFORM_EXPRESSION_BYTES + 1),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "LIMIT_EXCEEDED");
    }
  });

  it("measures expression size in UTF-8 bytes", () => {
    const source = constant("é".repeat(4_100));
    const result = validateTransformExpression(source);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "LIMIT_EXCEEDED");
    }
  });
});
