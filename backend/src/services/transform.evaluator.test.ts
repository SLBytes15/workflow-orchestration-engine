import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateTransform,
  type TransformEvaluationResult,
} from "./transform.evaluator";

function document(expression: unknown): string {
  return JSON.stringify({ version: 1, expression });
}

function constant(value: unknown): string {
  return document({ operation: "constant", value });
}

function get(path: Array<string | number>): string {
  return document({ operation: "get", path });
}

function expectFailure(
  result: TransformEvaluationResult,
  code: string,
): void {
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, code);
  }
}

describe("evaluateTransform", () => {
  it("returns detached JSON-compatible constant values", () => {
    for (const value of [
      null,
      false,
      "text",
      12.5,
      [1, null, { nested: true }],
      { nested: { value: "ok" } },
    ]) {
      const result = evaluateTransform(constant(value), {});
      assert.deepEqual(result, { ok: true, value });
      if (result.ok && typeof result.value === "object" && result.value !== null) {
        assert.notStrictEqual(result.value, value);
      }
    }
  });

  it("reads own object fields and array indices", () => {
    assert.deepEqual(evaluateTransform(get(["customer", "name"]), {
      customer: { name: "Ada" },
    }), { ok: true, value: "Ada" });
    assert.deepEqual(evaluateTransform(get(["items", 1]), {
      items: ["first", "second"],
    }), { ok: true, value: "second" });
  });

  it("returns a detached input root for an empty path", () => {
    const input = { nested: { value: 1 } };
    const result = evaluateTransform(get([]), input);
    assert.deepEqual(result, { ok: true, value: input });
    assert.notStrictEqual(result.ok && result.value, input);
    if (result.ok && typeof result.value === "object" && result.value !== null) {
      assert.notStrictEqual(result.value.nested, input.nested);
    }
  });

  it("builds nested objects with every child evaluated against the same root", () => {
    const expression = document({
      operation: "object",
      fields: {
        name: { operation: "get", path: ["customer", "name"] },
        status: { operation: "constant", value: "ready" },
        city: { operation: "get", path: ["customer", "address", "city"] },
      },
    });
    assert.deepEqual(
      evaluateTransform(expression, {
        customer: { name: "Ada", address: { city: "London" } },
      }),
      { ok: true, value: { name: "Ada", status: "ready", city: "London" } },
    );
    assert.deepEqual(
      evaluateTransform(document({ operation: "object", fields: {} }), {}),
      { ok: true, value: {} },
    );
  });

  it("distinguishes explicit null from missing properties", () => {
    assert.deepEqual(
      evaluateTransform(get(["present"]), { present: null }),
      { ok: true, value: null },
    );
    expectFailure(evaluateTransform(get(["missing"]), {}), "MISSING_PATH");
  });

  it("returns deterministic failures for incompatible traversal and indices", () => {
    expectFailure(
      evaluateTransform(get(["value", "next"]), { value: null }),
      "TYPE_MISMATCH",
    );
    expectFailure(
      evaluateTransform(get(["value", "next"]), { value: 1 }),
      "TYPE_MISMATCH",
    );
    expectFailure(
      evaluateTransform(get(["items", 2]), { items: [1] }),
      "MISSING_PATH",
    );
    expectFailure(
      evaluateTransform(get(["items", "0"]), { items: [1] }),
      "TYPE_MISMATCH",
    );
    expectFailure(
      evaluateTransform(get(["toString"]), {}),
      "MISSING_PATH",
    );
  });

  it("does not mutate the supplied input or alias returned values", () => {
    const input = { nested: { value: 1 } };
    const original = structuredClone(input);
    const result = evaluateTransform(get([]), input);
    assert.deepEqual(input, original);
    assert.equal(result.ok, true);
    if (result.ok && typeof result.value === "object" && result.value !== null) {
      (
        (result.value as Record<string, unknown>).nested as {
          value: number;
        }
      ).value = 2;
    }
    assert.deepEqual(input, original);
  });

  it("returns stable structured errors for invalid expressions", () => {
    const malformed = evaluateTransform("{", {});
    expectFailure(malformed, "MALFORMED_EXPRESSION");
    if (!malformed.ok) {
      assert.deepEqual(malformed.error, {
        code: "MALFORMED_EXPRESSION",
        message: "Expression JSON is malformed.",
      });
    }
    expectFailure(
      evaluateTransform(
        '{"version":1,"expression":{"operation":"get","path":["x","__proto__"]}}',
        {},
      ),
      "INVALID_EXPRESSION",
    );
  });

  it("rejects non-object, non-JSON, dangerous-key, and over-nested inputs", () => {
    expectFailure(
      evaluateTransform(constant(1), null as unknown as Record<string, unknown>),
      "INVALID_INPUT",
    );

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expectFailure(evaluateTransform(constant(1), cyclic), "INVALID_INPUT");

    const dangerous = JSON.parse('{"__proto__":{"unsafe":true}}') as Record<
      string,
      unknown
    >;
    expectFailure(evaluateTransform(constant(1), dangerous), "INVALID_INPUT");

    let nested: unknown = null;
    for (let index = 0; index < 33; index += 1) {
      nested = [nested];
    }
    expectFailure(
      evaluateTransform(constant(1), { nested }),
      "INVALID_INPUT",
    );

    const arrayWithProperty = [1] as number[] & { extra?: number };
    arrayWithProperty.extra = 2;
    expectFailure(
      evaluateTransform(constant(1), { items: arrayWithProperty }),
      "INVALID_INPUT",
    );
    expectFailure(
      evaluateTransform(constant(1), { value: Number.NaN }),
      "INVALID_INPUT",
    );
    expectFailure(
      evaluateTransform(constant(1), { value: [1, , 3] }),
      "INVALID_INPUT",
    );
    const accessorInput = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => 1,
    });
    expectFailure(
      evaluateTransform(constant(1), accessorInput),
      "INVALID_INPUT",
    );
    expectFailure(
      evaluateTransform(constant(1), { value: new Date(0) }),
      "INVALID_INPUT",
    );
  });

  it("accepts null-prototype JSON objects", () => {
    const input = Object.create(null) as Record<string, unknown>;
    input.value = 7;
    assert.deepEqual(evaluateTransform(get(["value"]), input), {
      ok: true,
      value: 7,
    });
  });
});
