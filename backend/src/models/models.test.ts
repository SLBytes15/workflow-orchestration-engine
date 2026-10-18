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

  it("accepts the supported execution statuses", async () => {
    for (const status of ["queued", "running", "completed", "failed"]) {
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
