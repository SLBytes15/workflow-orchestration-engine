import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getGlobalExecutions,
  getWorkflowExecutions,
} from "../src/api/executionApi";

describe("global and per-workflow execution API client", () => {
  it("rejects global execution requests without an API key", async () => {
    await assert.rejects(
      getGlobalExecutions("   "),
      /API authentication is not configured/,
    );
  });

  it("builds query parameters correctly for global execution history", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    let requestedHeaders: Record<string, string> = {};

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(url);
      requestedHeaders = (init?.headers as Record<string, string>) || {};
      return {
        ok: true,
        json: async () => ({
          message: "Execution history retrieved successfully",
          executions: [
            {
              id: "671600000000000000000001",
              workflowId: "671500000000000000000001",
              status: "completed",
              createdAt: "2026-10-21T10:00:00.000Z",
            },
          ],
          pagination: {
            limit: 25,
            hasMore: true,
            nextCursor: "test-cursor-token",
          },
        }),
      } as Response;
    }) as typeof fetch;

    try {
      const result = await getGlobalExecutions("valid-test-key", {
        workflowId: "671500000000000000000001",
        status: "completed",
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-31T23:59:59.999Z",
        executionId: "671600000000000000000001",
        limit: 25,
        cursor: "prev-cursor-token",
      });

      assert.equal(requestedHeaders["X-API-Key"], "valid-test-key");
      const url = new URL(requestedUrl);
      assert.equal(url.pathname, "/api/executions");
      assert.equal(url.searchParams.get("workflowId"), "671500000000000000000001");
      assert.equal(url.searchParams.get("status"), "completed");
      assert.equal(url.searchParams.get("from"), "2026-10-01T00:00:00.000Z");
      assert.equal(url.searchParams.get("to"), "2026-10-31T23:59:59.999Z");
      assert.equal(url.searchParams.get("executionId"), "671600000000000000000001");
      assert.equal(url.searchParams.get("limit"), "25");
      assert.equal(url.searchParams.get("cursor"), "prev-cursor-token");

      assert.equal(result.executions.length, 1);
      assert.equal(result.pagination.limit, 25);
      assert.equal(result.pagination.hasMore, true);
      assert.equal(result.pagination.nextCursor, "test-cursor-token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles empty global execution results correctly", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      return {
        ok: true,
        json: async () => ({
          message: "Execution history retrieved successfully",
          executions: [],
          pagination: {
            limit: 20,
            hasMore: false,
            nextCursor: null,
          },
        }),
      } as Response;
    }) as typeof fetch;

    try {
      const result = await getGlobalExecutions("valid-test-key");
      assert.deepEqual(result.executions, []);
      assert.equal(result.pagination.hasMore, false);
      assert.equal(result.pagination.nextCursor, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles API error responses cleanly", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            code: "VALIDATION_ERROR",
            message: "status must be one of the valid statuses",
          },
        }),
      } as Response;
    }) as typeof fetch;

    try {
      await assert.rejects(
        getGlobalExecutions("valid-test-key", { status: "invalid_status" }),
        /status must be one of the valid statuses/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves backward compatibility of getWorkflowExecutions", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    globalThis.fetch = (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return {
        ok: true,
        json: async () => ({
          message: "Execution history retrieved successfully",
          executions: [],
          pagination: {
            limit: 20,
            hasMore: false,
            nextCursor: null,
          },
        }),
      } as Response;
    }) as typeof fetch;

    try {
      await getWorkflowExecutions("wf-123", "test-key", { limit: 10 });
      const url = new URL(requestedUrl);
      assert.equal(url.pathname, "/api/workflows/wf-123/executions");
      assert.equal(url.searchParams.get("limit"), "10");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles All workflows + status filter correctly", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    globalThis.fetch = (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return {
        ok: true,
        json: async () => ({
          message: "Execution history retrieved successfully",
          executions: [],
          pagination: { limit: 20, hasMore: false, nextCursor: null },
        }),
      } as Response;
    }) as typeof fetch;

    try {
      await getGlobalExecutions("test-key", { status: "failed" });
      const url = new URL(requestedUrl);
      assert.equal(url.pathname, "/api/executions");
      assert.equal(url.searchParams.get("status"), "failed");
      assert.equal(url.searchParams.get("workflowId"), null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles All workflows + date filters correctly", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    globalThis.fetch = (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return {
        ok: true,
        json: async () => ({
          message: "Execution history retrieved successfully",
          executions: [],
          pagination: { limit: 20, hasMore: false, nextCursor: null },
        }),
      } as Response;
    }) as typeof fetch;

    try {
      await getGlobalExecutions("test-key", {
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-31T23:59:59.999Z",
      });
      const url = new URL(requestedUrl);
      assert.equal(url.pathname, "/api/executions");
      assert.equal(url.searchParams.get("from"), "2026-10-01T00:00:00.000Z");
      assert.equal(url.searchParams.get("to"), "2026-10-31T23:59:59.999Z");
      assert.equal(url.searchParams.get("workflowId"), null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles Specific workflow + status filter through global endpoint", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    globalThis.fetch = (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return {
        ok: true,
        json: async () => ({
          message: "Execution history retrieved successfully",
          executions: [],
          pagination: { limit: 20, hasMore: false, nextCursor: null },
        }),
      } as Response;
    }) as typeof fetch;

    try {
      await getGlobalExecutions("test-key", {
        workflowId: "671500000000000000000001",
        status: "running",
      });
      const url = new URL(requestedUrl);
      assert.equal(url.pathname, "/api/executions");
      assert.equal(url.searchParams.get("workflowId"), "671500000000000000000001");
      assert.equal(url.searchParams.get("status"), "running");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles Specific workflow + date filters through global endpoint", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    globalThis.fetch = (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return {
        ok: true,
        json: async () => ({
          message: "Execution history retrieved successfully",
          executions: [],
          pagination: { limit: 20, hasMore: false, nextCursor: null },
        }),
      } as Response;
    }) as typeof fetch;

    try {
      await getGlobalExecutions("test-key", {
        workflowId: "671500000000000000000001",
        from: "2026-10-15T00:00:00.000Z",
        to: "2026-10-20T23:59:59.999Z",
      });
      const url = new URL(requestedUrl);
      assert.equal(url.pathname, "/api/executions");
      assert.equal(url.searchParams.get("workflowId"), "671500000000000000000001");
      assert.equal(url.searchParams.get("from"), "2026-10-15T00:00:00.000Z");
      assert.equal(url.searchParams.get("to"), "2026-10-20T23:59:59.999Z");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles Pagination while filters are active", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    globalThis.fetch = (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return {
        ok: true,
        json: async () => ({
          message: "Execution history retrieved successfully",
          executions: [],
          pagination: { limit: 20, hasMore: false, nextCursor: null },
        }),
      } as Response;
    }) as typeof fetch;

    try {
      await getGlobalExecutions("test-key", {
        workflowId: "671500000000000000000001",
        status: "completed",
        cursor: "compound-cursor-token-page2",
        limit: 20,
      });
      const url = new URL(requestedUrl);
      assert.equal(url.pathname, "/api/executions");
      assert.equal(url.searchParams.get("workflowId"), "671500000000000000000001");
      assert.equal(url.searchParams.get("status"), "completed");
      assert.equal(url.searchParams.get("cursor"), "compound-cursor-token-page2");
      assert.equal(url.searchParams.get("limit"), "20");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles Execution ID search filter through global endpoint", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    globalThis.fetch = (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return {
        ok: true,
        json: async () => ({
          message: "Execution history retrieved successfully",
          executions: [
            {
              id: "671600000000000000000099",
              workflowId: "671500000000000000000001",
              status: "running",
            },
          ],
          pagination: { limit: 20, hasMore: false, nextCursor: null },
        }),
      } as Response;
    }) as typeof fetch;

    try {
      const result = await getGlobalExecutions("test-key", {
        executionId: "671600000000000000000099",
      });
      const url = new URL(requestedUrl);
      assert.equal(url.pathname, "/api/executions");
      assert.equal(url.searchParams.get("executionId"), "671600000000000000000099");
      assert.equal(result.executions.length, 1);
      assert.equal(result.executions[0].id, "671600000000000000000099");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("combines Execution ID search with workflow, status, and date filters", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    globalThis.fetch = (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return {
        ok: true,
        json: async () => ({
          message: "Execution history retrieved successfully",
          executions: [],
          pagination: { limit: 20, hasMore: false, nextCursor: null },
        }),
      } as Response;
    }) as typeof fetch;

    try {
      await getGlobalExecutions("test-key", {
        workflowId: "671500000000000000000001",
        status: "failed",
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-31T23:59:59.999Z",
        executionId: "671600000000000000000088",
      });
      const url = new URL(requestedUrl);
      assert.equal(url.pathname, "/api/executions");
      assert.equal(url.searchParams.get("workflowId"), "671500000000000000000001");
      assert.equal(url.searchParams.get("status"), "failed");
      assert.equal(url.searchParams.get("from"), "2026-10-01T00:00:00.000Z");
      assert.equal(url.searchParams.get("to"), "2026-10-31T23:59:59.999Z");
      assert.equal(url.searchParams.get("executionId"), "671600000000000000000088");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("omits executionId parameter when search filter is cleared", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    globalThis.fetch = (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return {
        ok: true,
        json: async () => ({
          message: "Execution history retrieved successfully",
          executions: [],
          pagination: { limit: 20, hasMore: false, nextCursor: null },
        }),
      } as Response;
    }) as typeof fetch;

    try {
      await getGlobalExecutions("test-key", {
        workflowId: "671500000000000000000001",
        executionId: undefined,
      });
      const url = new URL(requestedUrl);
      assert.equal(url.pathname, "/api/executions");
      assert.equal(url.searchParams.get("workflowId"), "671500000000000000000001");
      assert.equal(url.searchParams.has("executionId"), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

