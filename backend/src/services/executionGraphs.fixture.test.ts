import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateWorkflowGraph } from "../validators/workflow-graph.validator";
import { executeWorkflowGraph } from "./execution.runtime";
import { executionGraphCases, linearGraphCase } from "./executionGraphs.fixture";

describe("execution graph fixtures", () => {
  for (const testCase of executionGraphCases()) {
    it(`accepts the ${testCase.name} graph`, () => {
      assert.deepEqual(validateWorkflowGraph(testCase.graph), []);
    });

    it(`executes the ${testCase.name} graph deterministically`, async () => {
      const result = await executeWorkflowGraph(testCase.graph, testCase.input);

      assert.equal(result.status, "completed");
      assert.deepEqual(
        result.nodeResults.map((node) => node.nodeId),
        testCase.expectedNodeIds,
      );
    });
  }

  it("returns independent graph objects per factory call", () => {
    const first = linearGraphCase();
    const second = linearGraphCase();

    first.graph.nodes[0].data.label = "changed";

    assert.equal(second.graph.nodes[0].data.label, "Start");
  });
});