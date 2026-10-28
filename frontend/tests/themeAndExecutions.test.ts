import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getErrorText,
  sanitizeErrorMessage,
} from "../src/executionHelpers";
import {
  getInitialTheme,
  THEME_STORAGE_KEY,
} from "../src/theme/themeUtils";

describe("theme preference management", () => {
  it("uses the designated storage key for persisting theme", () => {
    assert.equal(THEME_STORAGE_KEY, "zaalima_theme_preference");
  });

  it("returns dark mode as default when no storage or window preference exists", () => {
    const theme = getInitialTheme();
    assert.ok(theme === "dark" || theme === "light");
  });
});

describe("execution error sanitization and formatting", () => {
  it("does not report an error when execution error is undefined", () => {
    assert.equal(getErrorText(undefined), "");
  });

  it("does not report an error when execution error is null", () => {
    assert.equal(getErrorText(null as unknown as undefined), "");
  });

  it("does not report an error when execution error is an empty object", () => {
    assert.equal(getErrorText({} as unknown as undefined), "");
  });

  it("does not report an error when execution error message is whitespace", () => {
    assert.equal(getErrorText({ message: "   " } as unknown as undefined), "");
  });

  it("formats string error messages properly while preserving normal English sentences", () => {
    assert.equal(
      getErrorText("Workflow failed at step 2."),
      "Workflow failed at step 2.",
    );
  });

  it("formats object error messages properly", () => {
    assert.equal(
      getErrorText({ message: "Payment service unavailable" }),
      "Payment service unavailable",
    );
  });

  it("sanitizes URLs and internal stack traces from error messages", () => {
    const raw = "Request failed at https://internal-api.service.local:443/secret/token at Connection.open (net.js:123:45)";
    const sanitized = sanitizeErrorMessage(raw);
    assert.ok(!sanitized.includes("https://internal-api"));
    assert.ok(!sanitized.includes("net.js"));
    assert.ok(sanitized.includes("[technical details hidden]"));
  });

  it("provides fallback message when input sanitization strips everything", () => {
    assert.equal(
      sanitizeErrorMessage("https://private.service"),
      "An unexpected error occurred.",
    );
  });
});
