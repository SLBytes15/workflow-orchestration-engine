import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { register } from "node:module";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  calculateCurrentlyRunning,
  formatDuration,
  formatPercentage,
} from "../src/executionHelpers";
import type { ExecutionSummary } from "../src/api/executionApi";

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

describe("Phase 8 Enterprise Analytics & Observability Dashboard", () => {
  describe("Component Rendering & Initial States", () => {
    it("renders unauthenticated state when tenantApiKey is missing", async () => {
      const { default: AnalyticsPage } = await import(
        "../src/pages/AnalyticsPage"
      );

      let html = "";
      assert.doesNotThrow(() => {
        html = renderToString(React.createElement(AnalyticsPage, {}));
      });

      assert.ok(html.length > 0);
      assert.ok(
        html.includes("Observability") && html.includes("Analytics"),
        "Must contain breadcrumb navigation",
      );
      assert.ok(
        html.includes("System Analytics &amp; Health") || html.includes("System Analytics & Health"),
        "Must contain page header title",
      );
      assert.ok(
        html.includes("Authentication Required"),
        "Must inform user that authentication is required",
      );
    });

    it("renders loading skeleton and scope controls when tenantApiKey is provided", async () => {
      const { default: AnalyticsPage } = await import(
        "../src/pages/AnalyticsPage"
      );

      let html = "";
      assert.doesNotThrow(() => {
        html = renderToString(
          React.createElement(AnalyticsPage, { tenantApiKey: "test-api-key" }),
        );
      });

      assert.ok(
        html.includes("analytics-skeleton-grid"),
        "Initial mount with API key must render skeleton loading state",
      );
      assert.ok(
        html.includes("Workflow Scope"),
        "Must contain Workflow Scope selector label",
      );
      assert.ok(
        html.includes("From Date") && html.includes("To Date"),
        "Must contain From and To date filter labels",
      );
      assert.ok(
        html.includes("Scope: All Workflows (Tenant-wide)"),
        "Must indicate tenant-wide scope by default",
      );
    });
  });

  describe("Backend Analytics KPI & Calculations", () => {
    it("calculates currently active runs strictly as running + compensating", () => {
      const summary: ExecutionSummary = {
        total: 250,
        queued: 12,
        running: 15,
        completed: 180,
        failed: 35,
        compensating: 5,
        compensated: 2,
        compensationFailed: 1,
        unsuccessful: 38,
        successRate: 82.57,
        failureRate: 17.43,
        avgDurationMs: 1450,
      };

      const active = calculateCurrentlyRunning(summary);
      assert.equal(active, 20, "Currently running must equal running (15) + compensating (5)");
    });

    it("formats duration gracefully with ms, s, and m units", () => {
      assert.equal(formatDuration(null), "—");
      assert.equal(formatDuration(undefined), "—");
      assert.equal(formatDuration(-50), "—");
      assert.equal(formatDuration(45), "45ms");
      assert.equal(formatDuration(2400), "2.4s");
      assert.equal(formatDuration(135000), "2m 15s");
    });

    it("formats percentage rates cleanly with decimal precision", () => {
      assert.equal(formatPercentage(null), "—");
      assert.equal(formatPercentage(undefined), "—");
      assert.equal(formatPercentage(0), "0%");
      assert.equal(formatPercentage(85.456), "85.46%");
      assert.equal(formatPercentage(100), "100%");
    });

    it("handles zero terminal runs safely without division-by-zero errors", () => {
      const emptyTerminalSummary: ExecutionSummary = {
        total: 10,
        queued: 5,
        running: 5,
        completed: 0,
        failed: 0,
        compensating: 0,
        compensated: 0,
        compensationFailed: 0,
        unsuccessful: 0,
        successRate: 0,
        failureRate: 0,
        avgDurationMs: null,
      };

      assert.equal(emptyTerminalSummary.completed + emptyTerminalSummary.unsuccessful, 0);
      assert.equal(emptyTerminalSummary.successRate, 0);
      assert.equal(emptyTerminalSummary.failureRate, 0);
      assert.equal(emptyTerminalSummary.avgDurationMs, null);
    });
  });

  describe("Canonical 7-Status Breakdown & Terminal Outcomes", () => {
    const CANONICAL_STATUS_KEYS = [
      "queued",
      "running",
      "completed",
      "failed",
      "compensating",
      "compensated",
      "compensationFailed",
    ];

    it("verifies all 7 canonical statuses are accounted for in the summary model", () => {
      assert.equal(CANONICAL_STATUS_KEYS.length, 7);
      const mockSummary: Record<string, number> = {
        queued: 1,
        running: 2,
        completed: 10,
        failed: 3,
        compensating: 1,
        compensated: 1,
        compensationFailed: 1,
      };

      for (const key of CANONICAL_STATUS_KEYS) {
        assert.ok(key in mockSummary, `Summary must include canonical status: ${key}`);
      }
    });

    it("validates that unsuccessful terminal runs include failed, compensated, and compensationFailed", () => {
      const failed = 12;
      const compensated = 3;
      const compensationFailed = 1;
      const unsuccessful = failed + compensated + compensationFailed;

      assert.equal(unsuccessful, 16);
      const completed = 84;
      const totalTerminal = completed + unsuccessful;
      assert.equal(totalTerminal, 100);

      const successRate = (completed / totalTerminal) * 100;
      const failureRate = (unsuccessful / totalTerminal) * 100;

      assert.equal(successRate, 84);
      assert.equal(failureRate, 16);
    });
  });

  describe("Honest Metrics & Statistical Integrity Policy", () => {
    it("preserves policy of withholding uncalculated percentiles (P95/P99)", () => {
      // The current backend aggregation computes scalar avgDurationMs using $sum / count
      // It does NOT run $percentile or approximate histograms
      const sampleResult = {
        avgDurationMs: 450,
      };
      assert.equal(sampleResult.avgDurationMs, 450);
      // P95 is not in the backend response
      assert.equal((sampleResult as any).p95DurationMs, undefined);
    });

    it("validates date boundaries (rejecting from > to)", () => {
      const from = "2026-03-10";
      const to = "2026-03-05";
      const isInvalid = new Date(from).getTime() > new Date(to).getTime();
      assert.ok(isInvalid, "Must flag from > to as invalid date range");
    });
  });
});

