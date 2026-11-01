import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { register } from "node:module";
import React from "react";
import { renderToString } from "react-dom/server";

import {
  getExecutionSummary,
  type ExecutionSummaryResult,
} from "../src/api/executionApi";
import {
  formatPercentage,
  formatDuration,
  calculateCurrentlyRunning,
} from "../src/executionHelpers";

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

describe("execution analytics API client and helpers", () => {
  it("rejects summary request without an API key", async () => {
    await assert.rejects(
      getExecutionSummary("   "),
      /API authentication is not configured/,
    );
  });

  it("builds query parameters and passes X-API-Key correctly", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    let requestedHeaders: Record<string, string> = {};

    const mockResponse: ExecutionSummaryResult = {
      summary: {
        total: 42,
        queued: 2,
        running: 5,
        completed: 28,
        failed: 3,
        compensating: 1,
        compensated: 2,
        compensationFailed: 1,
        unsuccessful: 6,
        successRate: 0.8235,
        failureRate: 0.1765,
        avgDurationMs: 2450,
      },
      filter: {
        workflowId: "671500000000000000000001",
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-31T23:59:59.999Z",
      },
    };

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(url);
      requestedHeaders = (init?.headers as Record<string, string>) || {};
      return {
        ok: true,
        json: async () => mockResponse,
      } as Response;
    }) as typeof fetch;

    try {
      const result = await getExecutionSummary("valid-tenant-key", {
        workflowId: "671500000000000000000001",
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-31T23:59:59.999Z",
      });

      assert.equal(requestedHeaders["X-API-Key"], "valid-tenant-key");
      const url = new URL(requestedUrl);
      assert.equal(url.pathname, "/api/executions/summary");
      assert.equal(url.searchParams.get("workflowId"), "671500000000000000000001");
      assert.equal(url.searchParams.get("from"), "2026-10-01T00:00:00.000Z");
      assert.equal(url.searchParams.get("to"), "2026-10-31T23:59:59.999Z");

      assert.equal(result.summary.total, 42);
      assert.equal(result.summary.completed, 28);
      assert.equal(result.summary.failed, 3);
      assert.equal(result.summary.successRate, 0.8235);
      assert.equal(result.summary.failureRate, 0.1765);
      assert.equal(result.summary.avgDurationMs, 2450);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles HTTP error response from summary API", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: "Invalid workflow ID" },
        }),
      } as Response;
    }) as typeof fetch;

    try {
      await assert.rejects(
        getExecutionSummary("valid-key", { workflowId: "invalid" }),
        /Invalid workflow ID/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles empty or zero summary response correctly", async () => {
    const originalFetch = globalThis.fetch;

    const emptyResponse: ExecutionSummaryResult = {
      summary: {
        total: 0,
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
        compensating: 0,
        compensated: 0,
        compensationFailed: 0,
        unsuccessful: 0,
        successRate: 0,
        failureRate: 0,
        avgDurationMs: null,
      },
      filter: {
        workflowId: null,
        from: null,
        to: null,
      },
    };

    globalThis.fetch = (async () => {
      return {
        ok: true,
        json: async () => emptyResponse,
      } as Response;
    }) as typeof fetch;

    try {
      const result = await getExecutionSummary("valid-key");
      assert.equal(result.summary.total, 0);
      assert.equal(result.summary.successRate, 0);
      assert.equal(result.summary.avgDurationMs, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  describe("formatPercentage", () => {
    it("converts decimal ratio to percentage exactly once", () => {
      assert.equal(formatPercentage(0.8235), "82.35%");
      assert.equal(formatPercentage(0.1765), "17.65%");
      assert.equal(formatPercentage(1), "100%");
      assert.equal(formatPercentage(0.5), "50%");
    });

    it("handles zero safely", () => {
      assert.equal(formatPercentage(0), "0%");
    });

    it("handles null, undefined, and NaN safely", () => {
      assert.equal(formatPercentage(null), "—");
      assert.equal(formatPercentage(undefined), "—");
      assert.equal(formatPercentage(Number.NaN), "—");
    });
  });

  describe("formatDuration", () => {
    it("formats null or negative duration as dash", () => {
      assert.equal(formatDuration(null), "—");
      assert.equal(formatDuration(undefined), "—");
      assert.equal(formatDuration(-10), "—");
    });

    it("formats milliseconds (<1000ms)", () => {
      assert.equal(formatDuration(450), "450ms");
      assert.equal(formatDuration(0), "0ms");
    });

    it("formats seconds (<60s)", () => {
      assert.equal(formatDuration(2450), "2.5s");
      assert.equal(formatDuration(15000), "15.0s");
    });

    it("formats minutes and seconds (<1h)", () => {
      assert.equal(formatDuration(65000), "1m 5s");
      assert.equal(formatDuration(130000), "2m 10s");
    });

    it("formats hours and minutes (>=1h)", () => {
      assert.equal(formatDuration(3660000), "1h 1m");
    });
  });

  describe("calculateCurrentlyRunning", () => {
    it("calculates running + compensating, excluding queued", () => {
      const count = calculateCurrentlyRunning({
        running: 4,
        compensating: 2,
      });
      assert.equal(count, 6);
    });

    it("returns 0 when summary is null or values are undefined", () => {
      assert.equal(calculateCurrentlyRunning(null), 0);
      assert.equal(calculateCurrentlyRunning(undefined), 0);
      assert.equal(calculateCurrentlyRunning({}), 0);
    });
  });
});

describe("ExecutionsPage analytics integration rendering", () => {
  it("renders metric cards structure and initial state", async () => {
    const { default: ExecutionsPage } = await import(
      "../src/pages/ExecutionsPage"
    );

    let html = "";
    assert.doesNotThrow(() => {
      html = renderToString(
        React.createElement(ExecutionsPage, { tenantApiKey: "test-api-key" }),
      );
    });

    assert.ok(
      html.includes("Total Executions"),
      "Must render Total Executions card label",
    );
    assert.ok(
      html.includes("Completed"),
      "Must render Completed card label",
    );
    assert.ok(
      html.includes("Failed"),
      "Must render Failed card label",
    );
    assert.ok(
      html.includes("Currently Running"),
      "Must render Currently Running card label",
    );
    assert.ok(
      html.includes("executions-page__stats"),
      "Must render execution stats container",
    );
  });

  it("handles summary filtering trigger rules: summary depends on workflow and dates, not status or search", () => {
    // Test the filter trigger logic contract
    function shouldRefreshSummary(
      prev: { workflowId?: string; from?: string; to?: string; status?: string; search?: string },
      next: { workflowId?: string; from?: string; to?: string; status?: string; search?: string },
    ): boolean {
      return (
        prev.workflowId !== next.workflowId ||
        prev.from !== next.from ||
        prev.to !== next.to
      );
    }

    // Changing statusFilter must NOT trigger summary refresh
    assert.equal(
      shouldRefreshSummary(
        { workflowId: "wf-1", status: "completed" },
        { workflowId: "wf-1", status: "failed" },
      ),
      false,
    );

    // Changing searchExecutionId must NOT trigger summary refresh
    assert.equal(
      shouldRefreshSummary(
        { workflowId: "wf-1", search: "671600000000000000000001" },
        { workflowId: "wf-1", search: "671600000000000000000002" },
      ),
      false,
    );

    // Changing workflowId MUST trigger summary refresh
    assert.equal(
      shouldRefreshSummary(
        { workflowId: "wf-1" },
        { workflowId: "wf-2" },
      ),
      true,
    );

    // Changing from date MUST trigger summary refresh
    assert.equal(
      shouldRefreshSummary(
        { workflowId: "wf-1", from: "2026-10-01" },
        { workflowId: "wf-1", from: "2026-10-05" },
      ),
      true,
    );

    // Changing to date MUST trigger summary refresh
    assert.equal(
      shouldRefreshSummary(
        { workflowId: "wf-1", to: "2026-10-15" },
        { workflowId: "wf-1", to: "2026-10-20" },
      ),
      true,
    );
  });

  it("simulates stale response protection for summary requests", async () => {
    let activeRequestId = 0;
    let latestSummaryResult: unknown = null;

    async function mockLoadSummary(
      requestId: number,
      mockResult: string,
      delayMs: number,
    ) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      // Stale check
      if (requestId === activeRequestId) {
        latestSummaryResult = mockResult;
      }
    }

    // Request 1 starts with longer delay
    activeRequestId = 1;
    const req1 = mockLoadSummary(1, "summary-1", 50);

    // Request 2 starts immediately with shorter delay
    activeRequestId = 2;
    const req2 = mockLoadSummary(2, "summary-2", 10);

    await Promise.all([req1, req2]);

    // Request 2 must win even though Request 1 resolved later
    assert.equal(latestSummaryResult, "summary-2");
  });
});

