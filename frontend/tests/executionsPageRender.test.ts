import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { register } from "node:module";
import React from "react";
import { renderToString } from "react-dom/server";

// Ensure React is globally available for TSX transform when evaluated outside Vite
(globalThis as unknown as { React: typeof React }).React = React;

// Transparently handle CSS imports in Node test environment
const cssLoader = `
export async function load(url, context, nextLoad) {
  if (url.endsWith(".css")) {
    return {
      format: "module",
      shortCircuit: true,
      source: "export default {}"
    };
  }
  return nextLoad(url, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(cssLoader)}`);

describe("ExecutionsPage component initialization and render regression", () => {
  it("initializes and renders ExecutionsPage without TDZ ReferenceError for loadHistory", async () => {
    const { default: ExecutionsPage } = await import(
      "../src/pages/ExecutionsPage"
    );

    let html = "";
    assert.doesNotThrow(() => {
      html = renderToString(
        React.createElement(ExecutionsPage, { tenantApiKey: "test-api-key" }),
      );
    }, "ExecutionsPage must not throw during initialization or initial render");

    assert.ok(html.length > 0, "Rendered HTML output must not be empty");
    assert.ok(
      html.includes("Executions"),
      "Rendered HTML must contain Executions header",
    );
    assert.ok(
      html.includes("executions-page__ws-indicator"),
      "Rendered HTML must contain realtime connection indicator",
    );
    assert.ok(
      html.includes("executions-page__breadcrumb"),
      "Rendered HTML must contain breadcrumb container",
    );
    assert.ok(
      html.includes("Observability") && html.includes("Execution History"),
      "Rendered HTML must contain Observability / Execution History breadcrumb text",
    );
    assert.ok(
      html.includes("executions-page__stats"),
      "Rendered HTML must contain summary stats grid",
    );
    assert.ok(
      html.includes("Total Executions") &&
        html.includes("Completed") &&
        html.includes("Failed") &&
        html.includes("Currently Running"),
      "Rendered HTML must contain 4 summary metrics cards",
    );
    assert.ok(
      html.includes("executions-skeleton-table") || html.includes("executions-table"),
      "Rendered HTML must contain executions skeleton table or execution table structure",
    );
    assert.ok(
      html.includes("Loading execution history...") || html.includes("Execution Records"),
      "Rendered HTML must contain loading indicator or execution records heading",
    );
  });

  it("safely initializes without tenantApiKey and renders unauthenticated state", async () => {
    const { default: ExecutionsPage } = await import(
      "../src/pages/ExecutionsPage"
    );

    let html = "";
    assert.doesNotThrow(() => {
      html = renderToString(React.createElement(ExecutionsPage, {}));
    }, "ExecutionsPage must not throw when rendered without tenantApiKey");

    assert.ok(html.length > 0);
    assert.ok(
      html.includes("API authentication is not configured.") ||
        html.includes("Executions"),
    );
  });
});
