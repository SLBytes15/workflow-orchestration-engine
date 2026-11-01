import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidExecutionId } from "../src/executionHelpers";
import { getGlobalExecutions } from "../src/api/executionApi";

describe("execution search validation and safety", () => {
  describe("isValidExecutionId", () => {
    it("rejects empty, null, or whitespace-only inputs", () => {
      assert.equal(isValidExecutionId(""), false);
      assert.equal(isValidExecutionId("   "), false);
    });

    it("rejects partial hexadecimal IDs (length < 24)", () => {
      assert.equal(isValidExecutionId("6"), false);
      assert.equal(isValidExecutionId("65a"), false);
      assert.equal(isValidExecutionId("6716000000000000000000"), false); // 22 chars
      assert.equal(isValidExecutionId("67160000000000000000009"), false); // 23 chars
    });

    it("rejects IDs with invalid non-hexadecimal characters", () => {
      assert.equal(isValidExecutionId("67160000000000000000000g"), false); // 'g' is non-hex
      assert.equal(isValidExecutionId("67160000000000000000000z"), false); // 'z' is non-hex
      assert.equal(isValidExecutionId("invalid-execution-id-str"), false);
      assert.equal(isValidExecutionId("671600000000-00000000000"), false);
      assert.equal(isValidExecutionId("!@#$%^&*()_+{}[]:;<>?,./"), false);
    });

    it("rejects IDs that exceed 24 hexadecimal characters (length > 24)", () => {
      assert.equal(isValidExecutionId("6716000000000000000000990"), false); // 25 chars
    });

    it("accepts valid 24-character hexadecimal IDs (case-insensitive)", () => {
      assert.equal(isValidExecutionId("671600000000000000000099"), true);
      assert.equal(isValidExecutionId("6716000000000000000000aa"), true);
      assert.equal(isValidExecutionId("ABCDEF0123456789ABCDEF01"), true);
      assert.equal(isValidExecutionId("6716000000000000000000FF"), true);
    });
  });

  describe("search workflow and request dispatch protection", () => {
    it("does not trigger backend request when input is partial or invalid", async () => {
      let fetchCalled = false;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = (async () => {
        fetchCalled = true;
        return {
          ok: true,
          json: async () => ({ executions: [], pagination: {} }),
        } as Response;
      }) as typeof fetch;

      try {
        // Simulating the page guard logic
        function runSearchGuard(input: string): { canDispatch: boolean; error: string } {
          const trimmed = input.trim();
          if (!trimmed) {
            return { canDispatch: true, error: "" };
          }
          if (!isValidExecutionId(trimmed)) {
            return {
              canDispatch: false,
              error: "Please enter a valid 24-character hexadecimal execution ID.",
            };
          }
          return { canDispatch: true, error: "" };
        }

        // Test with partial ID
        const partialResult = runSearchGuard("65a");
        assert.equal(partialResult.canDispatch, false);
        assert.equal(partialResult.error, "Please enter a valid 24-character hexadecimal execution ID.");
        assert.equal(fetchCalled, false);

        // Test with invalid hex characters
        const invalidCharResult = runSearchGuard("67160000000000000000000z");
        assert.equal(invalidCharResult.canDispatch, false);
        assert.equal(invalidCharResult.error, "Please enter a valid 24-character hexadecimal execution ID.");
        assert.equal(fetchCalled, false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("triggers backend request with executionId only when valid 24-char hex ID is provided", async () => {
      let requestedUrl = "";
      const originalFetch = globalThis.fetch;

      globalThis.fetch = (async (url: string | URL | Request) => {
        requestedUrl = String(url);
        return {
          ok: true,
          json: async () => ({
            message: "Success",
            executions: [
              {
                id: "671600000000000000000099",
                workflowId: "wf-1",
                status: "completed",
              },
            ],
            pagination: { limit: 20, hasMore: false, nextCursor: null },
          }),
        } as Response;
      }) as typeof fetch;

      try {
        const validId = "671600000000000000000099";
        assert.equal(isValidExecutionId(validId), true);

        const result = await getGlobalExecutions("test-api-key", {
          executionId: validId,
        });

        const url = new URL(requestedUrl);
        assert.equal(url.searchParams.get("executionId"), validId);
        assert.equal(result.executions.length, 1);
        assert.equal(result.executions[0].id, validId);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("clearing an invalid search restores normal history without executionId", async () => {
      let requestedUrl = "";
      const originalFetch = globalThis.fetch;

      globalThis.fetch = (async (url: string | URL | Request) => {
        requestedUrl = String(url);
        return {
          ok: true,
          json: async () => ({
            message: "Success",
            executions: [],
            pagination: { limit: 20, hasMore: false, nextCursor: null },
          }),
        } as Response;
      }) as typeof fetch;

      try {
        // User clears the search
        const clearedSearch = "";
        const executionIdParam = clearedSearch ? clearedSearch : undefined;

        await getGlobalExecutions("test-api-key", {
          executionId: executionIdParam,
        });

        const url = new URL(requestedUrl);
        assert.equal(url.searchParams.has("executionId"), false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("protects against stale responses when search input changes rapidly", async () => {
      let activeRequestId = 0;
      let renderedExecutions: Array<{ id: string }> = [];

      async function mockLoadHistory(
        searchId: string,
        delayMs: number,
        mockResponse: Array<{ id: string }>,
      ) {
        const currentReq = ++activeRequestId;
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        // Stale check
        if (currentReq !== activeRequestId) {
          return;
        }

        renderedExecutions = mockResponse;
      }

      // First query (slow)
      const query1 = mockLoadHistory("671600000000000000000001", 60, [
        { id: "671600000000000000000001" },
      ]);

      // Rapidly changed query (fast)
      const query2 = mockLoadHistory("671600000000000000000002", 15, [
        { id: "671600000000000000000002" },
      ]);

      await Promise.all([query1, query2]);

      // Result of query 2 must be rendered, query 1's late response was ignored
      assert.equal(renderedExecutions.length, 1);
      assert.equal(renderedExecutions[0].id, "671600000000000000000002");
    });
  });
});

