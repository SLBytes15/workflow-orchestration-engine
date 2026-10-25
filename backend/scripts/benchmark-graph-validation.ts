/**
 * Reproducible micro-benchmark for workflow graph validation.
 *
 * Measures pure, in-process CPU time of `validateWorkflowGraph()` on
 * synthetically generated graph payloads. That function is the safe path this
 * repository already supports: it is pure, deterministic, and runs on workflow
 * graph create/update without touching MongoDB or the network.
 *
 * Scope
 * -----
 * Measured:    validateWorkflowGraph() CPU time, in-process, single thread.
 * Not measured: HTTP latency, MongoDB, tenant isolation, concurrency,
 *               Saga runtime, workflow execution.
 * This is a micro-benchmark, not a load test. It asserts no thresholds.
 *
 * Workloads
 * ---------
 * chain-<n>   trigger -> task -> task ... (n nodes, n-1 edges)
 *             Exercises the adjacency build and the recursive cycle check.
 * wide-<n>    trigger -> n condition nodes, each with one `true` and one
 *             `false` edge to its own task (3n+1 nodes, 3n edges).
 *             Exercises condition branch bookkeeping.
 *
 * Every workload is validated once before timing; a non-empty error list aborts
 * the run, so cached timing is never reported for an invalid fixture.
 *
 * Protocol
 * --------
 * Default: 10 warm-up runs, then 30 timed samples per workload.
 * Reported: sample count, median, p95 (nearest rank), min, max, in milliseconds.
 *
 * Usage
 * -----
 *   cd backend
 *   npx tsx scripts/benchmark-graph-validation.ts
 *   npx tsx scripts/benchmark-graph-validation.ts --samples=50 --warmup=20
 *
 * Known limitation
 * ----------------
 * The validator's cycle check is recursive. Linear chains above roughly 6,000
 * nodes exceed the default call stack (`RangeError: Maximum call stack size
 * exceeded`), so chain workloads stop at 5,000 here. See
 * docs/backend/graph-validation-benchmark.md.
 */

import { cpus, platform, release } from "node:os";
import { performance } from "node:perf_hooks";

import {
  validateWorkflowGraph,
  type WorkflowGraph,
} from "../src/validators/workflow-graph.validator";

const DEFAULT_WARMUP_RUNS = 10;
const DEFAULT_SAMPLES = 30;

interface Workload {
  label: string;
  graph: WorkflowGraph;
}

interface SampleSummary {
  sampleCount: number;
  median: number;
  p95: number;
  min: number;
  max: number;
}

/**
 * Linear graph: trigger followed by `size - 1` tasks in a single chain.
 */
function buildChainGraph(size: number): WorkflowGraph {
  const nodes: WorkflowGraph["nodes"] = [
    {
      id: "node-0",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: { type: "trigger", label: "Chain start" },
    },
  ];
  const edges: WorkflowGraph["edges"] = [];

  for (let index = 1; index < size; index += 1) {
    nodes.push({
      id: `node-${index}`,
      type: "task",
      position: { x: index * 10, y: 0 },
      data: { type: "task", label: `Chain task ${index}` },
    });
    edges.push({
      id: `edge-${index}`,
      source: `node-${index - 1}`,
      target: `node-${index}`,
    });
  }

  return { version: 1, nodes, edges };
}

/**
 * Fan-out graph: one trigger into `conditions` condition nodes, each with a
 * distinct `true` and `false` branch, which the validator requires.
 */
function buildWideConditionGraph(conditions: number): WorkflowGraph {
  const nodes: WorkflowGraph["nodes"] = [
    {
      id: "trigger-1",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: { type: "trigger", label: "Fan-out start" },
    },
  ];
  const edges: WorkflowGraph["edges"] = [];

  for (let index = 0; index < conditions; index += 1) {
    const conditionId = `condition-${index}`;

    nodes.push({
      id: conditionId,
      type: "condition",
      position: { x: 200, y: index * 10 },
      data: {
        type: "condition",
        label: `Condition ${index}`,
        config: {
          type: "clause",
          clause: { left: "approved", op: "equals", right: true },
        },
      },
    });
    nodes.push({
      id: `task-true-${index}`,
      type: "task",
      position: { x: 400, y: index * 10 },
      data: { type: "task", label: `Approved ${index}` },
    });
    nodes.push({
      id: `task-false-${index}`,
      type: "task",
      position: { x: 600, y: index * 10 },
      data: { type: "task", label: `Rejected ${index}` },
    });

    edges.push({
      id: `edge-trigger-${index}`,
      source: "trigger-1",
      target: conditionId,
    });
    edges.push({
      id: `edge-true-${index}`,
      source: conditionId,
      target: `task-true-${index}`,
      sourceHandle: "true",
    });
    edges.push({
      id: `edge-false-${index}`,
      source: conditionId,
      target: `task-false-${index}`,
      sourceHandle: "false",
    });
  }

  return { version: 1, nodes, edges };
}

/**
 * Nearest-rank percentile over an ascending sample array.
 */
function percentile(sortedSamples: number[], target: number): number {
  const rank = Math.ceil((target / 100) * sortedSamples.length);
  const index = Math.min(sortedSamples.length - 1, Math.max(0, rank - 1));

  return sortedSamples[index];
}

function measure(
  graph: WorkflowGraph,
  warmupRuns: number,
  sampleCount: number,
): SampleSummary {
  for (let run = 0; run < warmupRuns; run += 1) {
    validateWorkflowGraph(graph);
  }

  const samples: number[] = [];

  for (let run = 0; run < sampleCount; run += 1) {
    const startedAt = performance.now();
    validateWorkflowGraph(graph);
    samples.push(performance.now() - startedAt);
  }

  const sortedSamples = [...samples].sort((left, right) => left - right);

  return {
    sampleCount: samples.length,
    median: percentile(sortedSamples, 50),
    p95: percentile(sortedSamples, 95),
    min: sortedSamples[0],
    max: sortedSamples[sortedSamples.length - 1],
  };
}

function readPositiveIntegerFlag(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));

  if (argument === undefined) {
    return fallback;
  }

  const parsed = Number(argument.slice(prefix.length));

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer, received "${argument}"`);
  }

  return parsed;
}

function main(): void {
  const warmupRuns = readPositiveIntegerFlag("warmup", DEFAULT_WARMUP_RUNS);
  const sampleCount = readPositiveIntegerFlag("samples", DEFAULT_SAMPLES);

  const workloads: Workload[] = [
    { label: "chain-500", graph: buildChainGraph(500) },
    { label: "chain-2000", graph: buildChainGraph(2000) },
    { label: "chain-5000", graph: buildChainGraph(5000) },
    { label: "wide-100", graph: buildWideConditionGraph(100) },
    { label: "wide-500", graph: buildWideConditionGraph(500) },
    { label: "wide-1000", graph: buildWideConditionGraph(1000) },
  ];

  console.log(`node=${process.version} platform=${platform()} ${release()}`);
  console.log(
    `cpu=${cpus()[0]?.model ?? "unknown"} cores=${cpus().length}`,
  );
  console.log(`warmup=${warmupRuns} samples=${sampleCount}`);
  console.log("");

  for (const workload of workloads) {
    const errors = validateWorkflowGraph(workload.graph);

    if (errors.length > 0) {
      throw new Error(
        `${workload.label} fixture is invalid: ${errors.join("; ")}`,
      );
    }

    const summary = measure(workload.graph, warmupRuns, sampleCount);
    const { nodes, edges } = workload.graph;

    console.log(
      [
        workload.label.padEnd(12),
        `nodes=${String(nodes.length).padStart(5)}`,
        `edges=${String(edges.length).padStart(5)}`,
        `samples=${summary.sampleCount}`,
        `median=${summary.median.toFixed(3)}ms`,
        `p95=${summary.p95.toFixed(3)}ms`,
        `min=${summary.min.toFixed(3)}ms`,
        `max=${summary.max.toFixed(3)}ms`,
      ].join(" "),
    );
  }
}

main();
