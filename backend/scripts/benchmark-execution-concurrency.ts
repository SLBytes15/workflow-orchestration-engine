/**
 * Safe local baseline for genuine in-process workflow concurrency.
 *
 * This harness does not start HTTP, connect to MongoDB, create tenant data, or
 * call external actions. It runs the existing execution runtime directly with
 * a synthetic delayed action and measures overlap between active handlers.
 *
 * It is a baseline harness, not proof of HTTP, database, ECS, or multi-instance
 * capacity. Run only in a local development environment:
 *
 *   cd backend
 *   npx tsx scripts/benchmark-execution-concurrency.ts
 *   npx tsx scripts/benchmark-execution-concurrency.ts --concurrency=1,5,10,25 --duration=25
 */

import { performance } from "node:perf_hooks";

import {
  executeWorkflowGraph,
  type ActionRegistry,
} from "../src/services/execution.runtime";
import type { WorkflowGraph } from "../src/validators/workflow-graph.validator";

const DEFAULT_CONCURRENCY = [1, 5, 10, 25];
const DEFAULT_DURATION_MS = 25;
const DEFAULT_REPETITIONS = 2;

interface BaselineResult {
  requested: number;
  completed: number;
  failed: number;
  maxActive: number;
  elapsedMs: number;
  throughputPerSecond: number;
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

function readConcurrencyLevels(): number[] {
  const prefix = "--concurrency=";
  const argument = process.argv.find((value) => value.startsWith(prefix));

  if (argument === undefined) {
    return DEFAULT_CONCURRENCY;
  }

  const levels = argument
    .slice(prefix.length)
    .split(",")
    .map((value) => Number(value.trim()));

  if (
    levels.length === 0 ||
    levels.some((value) => !Number.isInteger(value) || value < 1)
  ) {
    throw new Error(
      `--concurrency must be a comma-separated list of positive integers, received "${argument}"`,
    );
  }

  return [...new Set(levels)];
}

function buildSyntheticGraph(): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 0, y: 0 },
        data: { type: "trigger", label: "Synthetic start" },
      },
      {
        id: "task-1",
        type: "task",
        position: { x: 200, y: 0 },
        data: {
          type: "task",
          label: "Synthetic delayed task",
          config: {
            action: "transform",
            expression: "baseline",
          },
        },
      },
    ],
    edges: [{ id: "edge-1", source: "trigger-1", target: "task-1" }],
  };
}

function createDelayedActions(
  durationMs: number,
  onStart: () => void,
  onFinish: () => void,
): ActionRegistry {
  return {
    taskActions: {
      transform: {
        execute: async () => {
          onStart();
          await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
          onFinish();
          return { ok: true, output: { value: "baseline" } };
        },
      },
    },
  };
}

async function runBaseline(
  requested: number,
  durationMs: number,
): Promise<BaselineResult> {
  const graph = buildSyntheticGraph();
  let active = 0;
  let maxActive = 0;
  let completed = 0;
  let failed = 0;

  const startedAt = performance.now();
  const executions = Array.from({ length: requested }, () =>
    executeWorkflowGraph(
      graph,
      {},
      createDelayedActions(
        durationMs,
        () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
        },
        () => {
          active -= 1;
        },
      ),
    ).then((result) => {
      if (result.status === "completed") {
        completed += 1;
      } else {
        failed += 1;
      }
    }),
  );

  await Promise.all(executions);
  const elapsedMs = performance.now() - startedAt;

  return {
    requested,
    completed,
    failed,
    maxActive,
    elapsedMs,
    throughputPerSecond: (completed / elapsedMs) * 1000,
  };
}

async function main(): Promise<void> {
  const durationMs = readPositiveIntegerFlag("duration", DEFAULT_DURATION_MS);
  const repetitions = readPositiveIntegerFlag("repetitions", DEFAULT_REPETITIONS);
  const concurrencyLevels = readConcurrencyLevels();

  console.log(
    `runtime-baseline durationMs=${durationMs} repetitions=${repetitions} levels=${concurrencyLevels.join(",")}`,
  );
  console.log(
    "scope=in-process runtime only; no HTTP, MongoDB, WebSocket, Change Stream, or external action",
  );
  console.log("");

  for (const requested of concurrencyLevels) {
    const results: BaselineResult[] = [];

    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      results.push(await runBaseline(requested, durationMs));
    }

    const completed = results.reduce((sum, result) => sum + result.completed, 0);
    const failed = results.reduce((sum, result) => sum + result.failed, 0);
    const maxActive = Math.max(...results.map((result) => result.maxActive));
    const elapsedMs =
      results.reduce((sum, result) => sum + result.elapsedMs, 0) / results.length;
    const throughputPerSecond =
      results.reduce((sum, result) => sum + result.throughputPerSecond, 0) /
      results.length;

    if (completed !== requested * repetitions || failed !== 0) {
      throw new Error(
        `${requested} execution baseline did not complete cleanly: completed=${completed} failed=${failed}`,
      );
    }

    console.log(
      [
        `concurrency=${requested}`,
        `completed=${completed}`,
        `failed=${failed}`,
        `maxActive=${maxActive}`,
        `avgElapsedMs=${elapsedMs.toFixed(2)}`,
        `avgThroughputPerSecond=${throughputPerSecond.toFixed(2)}`,
      ].join(" "),
    );
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
