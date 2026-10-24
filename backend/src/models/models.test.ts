import assert from "node:assert/strict";
import { describe, it } from "node:test";
import TenantModel from "./tenant.model";
import WorkflowModel from "./workflow.model";
import { validGraph } from "../validators/validGraph.fixture";

import WorkflowExecutionModel from "./WorkflowExecution";


describe("Tenant schema", () => {
  it("requires name and slug", async () => {
    const tenant = new TenantModel({});
    await assert.rejects(tenant.validate(), (error: unknown) => {
      const validationError = error as { errors?: Record<string, unknown> };
      return Boolean(
        validationError.errors?.name && validationError.errors?.slug,
      );
    });
  });

  it("applies the active status default and validates allowed statuses", async () => {
    const tenant = new TenantModel({ name: "Example", slug: "example" });
    assert.equal(tenant.status, "active");
    await assert.doesNotReject(tenant.validate());
    tenant.set("status", "pending");
    await assert.rejects(tenant.validate());
  });

  it("declares a unique index on slug", () => {
    const slugIndex = TenantModel.schema
      .indexes()
      .find(([fields]) => fields.slug === 1);
    assert.ok(slugIndex, "Expected a slug index");
    assert.equal(slugIndex[1].unique, true);
  });

  it("enables timestamps", () => {
    assert.equal(TenantModel.schema.options.timestamps, true);
  });
});

describe("Workflow schema", () => {
  it("requires tenantId and name", async () => {
    const workflow = new WorkflowModel({});
    await assert.rejects(workflow.validate(), (error: unknown) => {
      const validationError = error as { errors?: Record<string, unknown> };
      return Boolean(
        validationError.errors?.tenantId && validationError.errors?.name,
      );
    });
  });

  it("uses an ObjectId reference to Tenant for tenantId", () => {
    const tenantIdPath = WorkflowModel.schema.path("tenantId");

    assert.equal(tenantIdPath.instance, "ObjectId");
    assert.equal(tenantIdPath.options.ref, "Tenant");
  });

  it("defaults status and version and validates allowed statuses", async () => {
    const workflow = new WorkflowModel({
      tenantId: "507f1f77bcf86cd799439011",
      name: "Example workflow",
      graph: validGraph,
    });

    assert.equal(workflow.status, "draft");
    assert.equal(workflow.version, 1);

    await assert.doesNotReject(workflow.validate());

    workflow.set("status", "pending");
    await assert.rejects(workflow.validate());
  });

  it("rejects a version below one", async () => {
    const workflow = new WorkflowModel({
      tenantId: "507f1f77bcf86cd799439011",
      name: "Example workflow",
      graph: validGraph,
      version: 0,
    });

    await assert.rejects(workflow.validate());
  });

  it("enables timestamps", () => {
    assert.equal(WorkflowModel.schema.options.timestamps, true);
  });
});


describe("WorkflowExecution schema", () => {
  const validExecution = () => ({
    tenantId: "507f1f77bcf86cd799439011",
    workflowId: "507f1f77bcf86cd799439012",
    workflowVersion: 1,
    graphSnapshot: {
      version: 1,
      nodes: [],
      edges: [],
    },
  });

  it("rejects a null graphSnapshot", async () => {
    const execution = new WorkflowExecutionModel({
      ...validExecution(),
      graphSnapshot: null,
    });

    await assert.rejects(
      execution.validate(),
      (error: unknown) => {
        const validationError = error as {
          errors?: Record<string, unknown>;
        };

        return Boolean(validationError.errors?.graphSnapshot);
      },
    );
  });

  it("requires tenantId, workflowId, workflowVersion, and graphSnapshot", async () => {
    const execution = new WorkflowExecutionModel({});

    await assert.rejects(execution.validate(), (error: unknown) => {
      const validationError = error as {
        errors?: Record<string, unknown>;
      };

      return Boolean(
        validationError.errors?.tenantId &&
        validationError.errors?.workflowId &&
        validationError.errors?.workflowVersion &&
        validationError.errors?.graphSnapshot,
      );
    });
  });

  it("uses ObjectId references for tenantId and workflowId", () => {
    const tenantIdPath = WorkflowExecutionModel.schema.path("tenantId");
    const workflowIdPath = WorkflowExecutionModel.schema.path("workflowId");

    assert.equal(tenantIdPath.instance, "ObjectId");
    assert.equal(tenantIdPath.options.ref, "Tenant");

    assert.equal(workflowIdPath.instance, "ObjectId");
    assert.equal(workflowIdPath.options.ref, "Workflow");
  });

  it("defaults status to queued and initializes execution fields", () => {
    const execution = new WorkflowExecutionModel(validExecution());

    assert.equal(execution.status, "queued");
    assert.equal(execution.currentNodeId, null);
    assert.deepEqual(execution.nodeResults, []);
    assert.equal(execution.error, null);
    assert.equal(execution.startedAt, null);
    assert.equal(execution.completedAt, null);
  });

  it("accepts legacy node results without compensation metadata", async () => {
    const execution = new WorkflowExecutionModel({
      ...validExecution(),
      nodeResults: [
        { nodeId: "node-1", status: "completed" },
        {
          nodeId: "node-2",
          status: "failed",
          error: { code: "NODE_FAILED", message: "Node failed" },
        },
      ],
    });

    await assert.doesNotReject(execution.validate());
    assert.equal(execution.nodeResults[0].compensation, undefined);
  });

  it("accepts nested compensation metadata", async () => {
    const execution = new WorkflowExecutionModel({
      ...validExecution(),
      status: "compensating",
      nodeResults: [
        {
          nodeId: "node-1",
          status: "completed",
          output: { reference: "example" },
          compensation: {
            status: "running",
            startedAt: new Date("2026-10-22T10:00:00.000Z"),
            completedAt: null,
            error: null,
          },
        },
      ],
    });

    await assert.doesNotReject(execution.validate());
    assert.equal(
      execution.nodeResults[0].compensation.status,
      "running",
    );
  });

  it("diagnoses unsupported node-result and compensation statuses", async () => {
    const invalidNodeResult = new WorkflowExecutionModel({
      ...validExecution(),
      nodeResults: [{ nodeId: "node-1", status: "interrupted" }],
    });

    const invalidCompensation = new WorkflowExecutionModel({
      ...validExecution(),
      nodeResults: [
        {
          nodeId: "node-1",
          status: "completed",
          compensation: { status: "interrupted" },
        },
      ],
    });

    const nodeResultError = await invalidNodeResult
      .validate()
      .then(() => null)
      .catch((error: unknown) => error);

    const compensationError = await invalidCompensation
      .validate()
      .then(() => null)
      .catch((error: unknown) => error);

    assert.ok(nodeResultError, "Expected invalid node status to fail validation");
    assert.ok(
      compensationError,
      "Expected invalid compensation status to fail validation",
    );
  });

  it("accepts Date compensation timestamps and optional null or absent values", async () => {
    const execution = new WorkflowExecutionModel({
      ...validExecution(),
      nodeResults: [
        {
          nodeId: "task-with-dates",
          status: "completed",
          compensation: {
            status: "completed",
            startedAt: new Date("2026-10-22T10:00:00.000Z"),
            completedAt: new Date("2026-10-22T10:01:00.000Z"),
          },
        },
        {
          nodeId: "task-with-null-dates",
          status: "completed",
          compensation: {
            status: "pending",
            startedAt: null,
            completedAt: null,
            error: null,
          },
        },
        {
          nodeId: "task-with-optional-dates",
          status: "completed",
          compensation: {
            status: "pending",
          },
        },
      ],
    });

    await assert.doesNotReject(execution.validate());
  });

  it("accepts the supported execution statuses", async () => {
    for (const status of [
      "queued",
      "running",
      "completed",
      "failed",
      "compensating",
      "compensated",
      "compensation_failed",
    ]) {
      const execution = new WorkflowExecutionModel({
        ...validExecution(),
        status,
      });

      await assert.doesNotReject(execution.validate());
    }
  });

  it("rejects an unsupported execution status", async () => {
    const execution = new WorkflowExecutionModel({
      ...validExecution(),
      status: "cancelled",
    });

    await assert.rejects(execution.validate());
  });

  it("accepts compensation metadata and rejects unsupported compensation states", async () => {
    const execution = new WorkflowExecutionModel({
      ...validExecution(),
      status: "compensating",
      nodeResults: [
        {
          nodeId: "task-a",
          status: "completed",
          compensation: {
            status: "running",
            startedAt: new Date(),
            completedAt: null,
            error: null,
          },
        },
      ],
    });

    await assert.doesNotReject(execution.validate());

    execution.nodeResults[0].compensation.status = "interrupted";
    await assert.rejects(execution.validate());
  });

it("rejects compensation metadata without a supported status", async () => {
  const execution = new WorkflowExecutionModel({
    ...validExecution(),
    nodeResults: [
      {
        nodeId: "task-a",
        status: "completed",
        compensation: {},
      },
    ],
  });

  await assert.rejects(execution.validate());
});

it("rejects invalid compensation timestamps", async () => {
  for (const field of ["startedAt", "completedAt"] as const) {
    for (const timestamp of [
      "2026-10-22T10:00:00.000Z",
      1792663200000,
      "not-a-date",
      new Date(Number.NaN),
      {},
    ]) {
      const execution = new WorkflowExecutionModel({
        ...validExecution(),
        nodeResults: [
          {
            nodeId: "task-a",
            status: "completed",
            compensation: {
              status: "running",
              [field]: timestamp,
            },
          },
        ],
      });

      await assert.rejects(execution.validate());
    }
  }
});

it("rejects malformed compensation error details", async () => {
  for (const error of [
    { message: "Rollback failed" },
    { code: "COMPENSATION_FAILED" },
    { code: 1, message: "Rollback failed" },
    [],
  ]) {
    const execution = new WorkflowExecutionModel({
      ...validExecution(),
      nodeResults: [
        {
          nodeId: "task-a",
          status: "completed",
          compensation: {
            status: "failed",
            error,
          },
        },
      ],
    });

    await assert.rejects(execution.validate());
  }
});
  it("preserves the original execution error separately when compensation fails", async () => {
    const originalError = {
      code: "EXECUTION_FAILED",
      message: "The workflow step failed",
      details: { nodeId: "node-1" },
    };

    const compensationError = {
      code: "COMPENSATION_FAILED",
      message: "Rollback failed",
    };
    const execution = new WorkflowExecutionModel({
      ...validExecution(),
      status: "compensation_failed",
      error: originalError,
      nodeResults: [
        {
          nodeId: "node-1",
          status: "completed",
          compensation: {
            status: "failed",
            startedAt: new Date(),
            completedAt: new Date(),
            error: compensationError,
          },
        },
      ],
    });

    await assert.doesNotReject(execution.validate());
    assert.deepEqual(execution.error, originalError);
    assert.deepEqual(
      execution.nodeResults[0].compensation.error,
      compensationError,
    );
  });

  it("rejects a workflow version below one", async () => {
    const execution = new WorkflowExecutionModel({
      ...validExecution(),
      workflowVersion: 0,
    });

    await assert.rejects(execution.validate());
  });

  it("enables timestamps", () => {
    assert.equal(WorkflowExecutionModel.schema.options.timestamps, true);
  });

  it("declares tenant-scoped query indexes", () => {
    const indexes = WorkflowExecutionModel.schema.indexes();

    assert.ok(
      indexes.some(
        ([fields]) =>
          fields.tenantId === 1 &&
          fields.workflowId === 1 &&
          fields.createdAt === -1,
      ),
    );

    assert.ok(
      indexes.some(([fields]) => fields.tenantId === 1 && fields._id === 1),
    );
  });
});
