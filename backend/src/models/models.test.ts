import assert from "node:assert/strict";
import { describe, it } from "node:test";
import TenantModel from "./tenant.model";
import WorkflowModel from "./workflow.model";
describe("Tenant schema", () => {
  it("requires name and slug", async () => {
    const tenant = new TenantModel({});
    await assert.rejects(tenant.validate(), (error: unknown) => {
      const validationError = error as { errors?: Record<string, unknown> };
      return Boolean(validationError.errors?.name && validationError.errors?.slug);
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
  it("references Tenant from tenantId", () => {
    assert.equal(WorkflowModel.schema.path("tenantId").options.ref, "Tenant");
  });
  it("defaults status and version and validates allowed statuses", async () => {
    const workflow = new WorkflowModel({
      tenantId: "507f1f77bcf86cd799439011",
      name: "Example workflow",
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
      version: 0,
    });
    await assert.rejects(workflow.validate());
  });
  it("enables timestamps", () => {
    assert.equal(WorkflowModel.schema.options.timestamps, true);
  });
});
