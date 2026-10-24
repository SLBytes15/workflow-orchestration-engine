# Graph Validation Benchmark

Micro-benchmark for `validateWorkflowGraph()` in
`backend/src/validators/workflow-graph.validator.ts`.

## Scope

**Measured:** pure, in-process CPU time of `validateWorkflowGraph()` on
synthetically generated graph payloads, single thread.

**Not measured:** HTTP latency, MongoDB, tenant isolation, concurrency,
Saga runtime, workflow execution. This is a micro-benchmark, **not a load test**,
and it asserts no thresholds or budgets.

Graph validation is the operation the workflow API runs on graph create/update,
and the validator is pure — no database, no network, no environment reads — so it
can be measured deterministically without test infrastructure.

## Command

```powershell
cd backend
npx tsx scripts/benchmark-graph-validation.ts
```

Optional overrides:

```powershell
npx tsx scripts/benchmark-graph-validation.ts --samples=50 --warmup=20
```

## Workloads

Generated from size parameters only; nothing random, no external data.

| Label | Shape | Nodes | Edges |
| --- | --- | --- | --- |
| `chain-500` | trigger + 499 tasks in a line | 500 | 499 |
| `chain-2000` | trigger + 1999 tasks in a line | 2,000 | 1,999 |
| `chain-5000` | trigger + 4999 tasks in a line | 5,000 | 4,999 |
| `wide-100` | trigger + 100 conditions, each with `true`/`false` branches | 301 | 300 |
| `wide-500` | trigger + 500 conditions, each with `true`/`false` branches | 1,501 | 1,500 |
| `wide-1000` | trigger + 1000 conditions, each with `true`/`false` branches | 3,001 | 3,000 |

Chain workloads exercise adjacency construction and the recursive cycle check.
Wide workloads exercise condition branch bookkeeping. Each workload is validated
once before timing; a non-empty error list aborts the run, so timings are never
reported for an invalid fixture.

## Protocol

- 10 warm-up runs per workload (JIT warm-up, discarded).
- 30 timed samples per workload, `performance.now()` from `node:perf_hooks`.
- Reported: sample count, median, p95 (nearest rank), min, max.

## Environment

Captured from the run itself:

- Node `v22.23.2`, `win32 10.0.26300` (Windows 11)
- CPU: AMD Ryzen 5 5600H with Radeon Graphics, 12 logical cores
- Run via `npx tsx` (`tsx 4.23.15`), single process, single thread

## Results

Two consecutive runs on the environment above, 24 October 2026.

| Workload | Samples | Median run 1 | p95 run 1 | Median run 2 | p95 run 2 |
| --- | --- | --- | --- | --- | --- |
| `chain-500` | 30 | 0.258 ms | 0.529 ms | 0.266 ms | 0.453 ms |
| `chain-2000` | 30 | 1.050 ms | 1.499 ms | 1.089 ms | 1.463 ms |
| `chain-5000` | 30 | 3.774 ms | 5.080 ms | 3.615 ms | 5.210 ms |
| `wide-100` | 30 | 0.211 ms | 0.381 ms | 0.170 ms | 0.341 ms |
| `wide-500` | 30 | 0.907 ms | 1.416 ms | 0.923 ms | 1.567 ms |
| `wide-1000` | 30 | 2.035 ms | 2.660 ms | 2.180 ms | 3.158 ms |

Run-to-run medians agree within roughly 2–10%; `wide-100` shows the largest
relative spread, which is expected at sub-millisecond scale. Read these as
baseline numbers on one developer machine, not as capacity figures.

## Limitations

- Single process, single thread, warm JIT: this does not predict server latency
  under real traffic, GC pressure from other allocations, or multi-tenant load.
- Workloads are synthetic and unweighted; they are not sampled from production
  graphs.
- No thresholds are asserted by design. A regression must be judged by comparing
  two runs on the same machine.
- **Observed ceiling:** the validator's cycle check is recursive, so a linear
  chain of about 6,000 nodes overflows the default stack
  (`RangeError: Maximum call stack size exceeded`). 5,800 nodes completed,
  6,000 nodes failed. Chain workloads therefore stop at 5,000. Documented only —
  no fix is included here.
- Timings include the cost of iterating the generated payload; graph generation
  happens before timing and is excluded.

## Related tests

```powershell
cd backend
npx tsx --test src/validators/workflow-graph.validator.test.ts
```

27 tests covering node/edge shape, duplicate IDs, condition branch handles,
cycle rejection, and the JSON fixtures in `docs/fixtures/`.
