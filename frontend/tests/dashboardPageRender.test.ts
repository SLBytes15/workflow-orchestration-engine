import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { register } from "node:module";
import React from "react";
import { renderToString } from "react-dom/server";

(globalThis as unknown as { React: typeof React }).React = React;

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

describe("DashboardPage render", () => {
  it("preserves primary workflow actions and shows data-aware dashboard sections", async () => {
    const [{ default: DashboardPage }, { initialWorkflows }] = await Promise.all([
      import("../src/pages/DashboardPage"),
      import("../src/workflowState"),
    ]);

    const html = renderToString(
      React.createElement(DashboardPage, {
        workflows: initialWorkflows,
        onNavigate: () => undefined,
      }),
    );

    assert.ok(html.includes("Dashboard"));
    assert.ok(html.includes("Create workflow"));
    assert.ok(html.includes("Open workflow builder"));
    assert.ok(html.includes("Open workflow catalog"));
    assert.ok(html.includes("View execution history"));
    assert.ok(html.includes("Execution health"));
    assert.ok(html.includes("Execution volume"));
    assert.ok(html.includes("Recent executions"));
    assert.ok(html.includes("Recent failures"));
    assert.ok(html.includes("Recent workflows"));
    assert.ok(html.includes("Quick actions"));
  });
});
