import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import {
  APPROVED_EVENT_SOURCE,
  buildExecutionEventEnvelope,
  matchEventFilter,
  validateBusinessEventDocument,
  validateEventTriggerConfig,
  validateTriggerConfigurations,
} from "./event-contract.validator";
import { validGraph } from "./validGraph.fixture";
import type { WorkflowGraph } from "./workflow-graph.validator";

describe("Business event document validation", () => {
  it("accepts a valid business event document and strips metadata from payload", () => {
    const eventId = new Types.ObjectId();
    const tenantId = new Types.ObjectId();

    const input = {
      _id: eventId,
      tenantId,
      eventName: "order.created",
      payload: {
        orderId: "ord-123",
        status: "pending",
        amount: 250,
        tenantId: "untrusted-spoof-attempt",
        _id: "fake-id",
      },
    };

    const result = validateBusinessEventDocument(input);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    assert.ok(result.event);
    assert.equal(result.event.eventName, "order.created");
    assert.equal(result.event._id.toString(), eventId.toString());
    assert.equal(result.event.tenantId.toString(), tenantId.toString());
    assert.equal(result.event.payload.orderId, "ord-123");
    assert.equal(result.event.payload.status, "pending");
    assert.equal(result.event.payload.amount, 250);
    // Verified: untrusted internal IDs inside payload are stripped
    assert.equal(result.event.payload.tenantId, undefined);
    assert.equal(result.event.payload._id, undefined);
  });

  it("accepts valid 24-character hexadecimal ObjectId strings", () => {
    const eventId = new Types.ObjectId().toString();
    const tenantId = new Types.ObjectId().toString();

    const result = validateBusinessEventDocument({
      _id: eventId,
      tenantId,
      eventName: "order.created",
      payload: { status: "pending" },
    });

    assert.equal(result.valid, true);
    assert.ok(result.event?._id instanceof Types.ObjectId);
    assert.ok(result.event?.tenantId instanceof Types.ObjectId);
  });

  it("defaults missing payload to an empty object", () => {
    const result = validateBusinessEventDocument({
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      eventName: "order.created",
    });

    assert.equal(result.valid, true);
    assert.deepEqual(result.event?.payload, {});
  });

  it("rejects non-object document inputs", () => {
    assert.equal(validateBusinessEventDocument(null).valid, false);
    assert.equal(validateBusinessEventDocument("string").valid, false);
    assert.equal(validateBusinessEventDocument([]).valid, false);
  });

  it("rejects missing or malformed _id and tenantId", () => {
    const result = validateBusinessEventDocument({
      _id: "not-an-objectid",
      tenantId: "not-an-objectid",
      eventName: "order.created",
    });

    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((err) =>
        err.includes("_id must be a valid MongoDB ObjectId"),
      ),
    );
    assert.ok(
      result.errors.some((err) =>
        err.includes("tenantId must be a valid top-level MongoDB ObjectId"),
      ),
    );
  });

  it("rejects missing or blank eventName", () => {
    const result = validateBusinessEventDocument({
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      eventName: "   ",
    });

    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((err) =>
        err.includes("eventName is required and must be a non-empty string"),
      ),
    );
  });

  it("rejects non-object payload", () => {
    const result = validateBusinessEventDocument({
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(),
      eventName: "order.created",
      payload: "not-an-object",
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((err) => err.includes("payload must be an object")));
  });
});

describe("Event trigger configuration validation", () => {
  it("accepts a valid event trigger configuration", () => {
    const config = {
      kind: "event",
      source: APPROVED_EVENT_SOURCE,
      eventName: "order.created",
      filter: {
        "payload.status": "pending",
        "payload.amount": 100,
        "payload.approved": true,
      },
    };

    const errors = validateEventTriggerConfig(config);
    assert.deepEqual(errors, []);
  });

  it("accepts an event trigger without a filter", () => {
    const config = {
      kind: "event",
      source: APPROVED_EVENT_SOURCE,
      eventName: "order.created",
    };

    const errors = validateEventTriggerConfig(config);
    assert.deepEqual(errors, []);
  });

  it("rejects unapproved sources like orders or workflows", () => {
    const errorsOrders = validateEventTriggerConfig({
      kind: "event",
      source: "orders",
      eventName: "order.created",
    });
    assert.ok(
      errorsOrders.some((err) =>
        err.includes(`Event trigger source must be '${APPROVED_EVENT_SOURCE}'`),
      ),
    );

    const errorsWorkflows = validateEventTriggerConfig({
      kind: "event",
      source: "workflows",
      eventName: "order.created",
    });
    assert.ok(
      errorsWorkflows.some((err) =>
        err.includes(`Event trigger source must be '${APPROVED_EVENT_SOURCE}'`),
      ),
    );
  });

  it("rejects filters that target tenantId or try to override tenant isolation", () => {
    const errors = validateEventTriggerConfig({
      kind: "event",
      source: APPROVED_EVENT_SOURCE,
      eventName: "order.created",
      filter: {
        tenantId: "507f1f77bcf86cd799439011",
        "payload.tenantId": "507f1f77bcf86cd799439011",
      },
    });

    assert.ok(
      errors.some((err) =>
        err.includes("Filter cannot target tenantId; tenant isolation is strictly enforced"),
      ),
    );
  });

  it("rejects filters that use MongoDB query operators or non-payload fields", () => {
    const errors = validateEventTriggerConfig({
      kind: "event",
      source: APPROVED_EVENT_SOURCE,
      eventName: "order.created",
      filter: {
        "$gt": 5,
        "status": "pending",
      },
    });

    assert.ok(
      errors.some((err) =>
        err.includes("cannot use MongoDB operator syntax"),
      ),
    );
    assert.ok(
      errors.some((err) =>
        err.includes("must target payload fields (e.g. 'payload.status')"),
      ),
    );
  });

  it("rejects non-primitive filter values", () => {
    const errors = validateEventTriggerConfig({
      kind: "event",
      source: APPROVED_EVENT_SOURCE,
      eventName: "order.created",
      filter: {
        "payload.nested": { $eq: "value" },
        "payload.list": [1, 2],
      },
    });

    assert.equal(errors.length, 2);
    assert.ok(
      errors.every((err) =>
        err.includes("must be a scalar equality primitive"),
      ),
    );
  });

  it("rejects forbidden property segments to prevent prototype pollution", () => {
    const errors = validateEventTriggerConfig({
      kind: "event",
      source: APPROVED_EVENT_SOURCE,
      eventName: "order.created",
      filter: {
        "payload.__proto__.polluted": "yes",
      },
    });

    assert.ok(
      errors.some((err) =>
        err.includes("contains forbidden property segments"),
      ),
    );
  });
});

describe("Graph trigger configuration validation", () => {
  it("accepts a graph where trigger has valid event configuration", () => {
    const graph: WorkflowGraph = {
      ...validGraph,
      nodes: validGraph.nodes.map((node) =>
        node.type === "trigger"
          ? {
              ...node,
              data: {
                ...node.data,
                config: {
                  kind: "event",
                  source: APPROVED_EVENT_SOURCE,
                  eventName: "order.created",
                  filter: { "payload.status": "pending" },
                },
              },
            }
          : node,
      ),
    };

    const errors = validateTriggerConfigurations(graph);
    assert.deepEqual(errors, []);
  });

  it("ignores trigger nodes without config or with other kinds like webhook", () => {
    const graph: WorkflowGraph = {
      ...validGraph,
      nodes: validGraph.nodes.map((node) =>
        node.type === "trigger"
          ? {
              ...node,
              data: {
                ...node.data,
                config: {
                  kind: "webhook",
                  method: "POST",
                  path: "/hook",
                },
              },
            }
          : node,
      ),
    };

    const errors = validateTriggerConfigurations(graph);
    assert.deepEqual(errors, []);
  });

  it("diagnoses invalid event trigger configurations inside a graph", () => {
    const graph: WorkflowGraph = {
      ...validGraph,
      nodes: validGraph.nodes.map((node) =>
        node.type === "trigger"
          ? {
              ...node,
              data: {
                ...node.data,
                config: {
                  kind: "event",
                  source: "invalid_source",
                  eventName: "",
                },
              },
            }
          : node,
      ),
    };

    const errors = validateTriggerConfigurations(graph);
    assert.ok(errors.length > 0);
    assert.ok(errors.some((err) => err.includes("Event trigger source must be 'business_events'")));
    assert.ok(errors.some((err) => err.includes("Event trigger eventName must be a non-empty string")));
  });
});

describe("Event filter matching", () => {
  const event = {
    _id: new Types.ObjectId(),
    tenantId: new Types.ObjectId(),
    eventName: "order.created",
    payload: {
      status: "pending",
      amount: 150,
      customer: {
        tier: "gold",
      },
    },
  };

  it("matches when filter is undefined or empty", () => {
    assert.equal(matchEventFilter(undefined, event), true);
    assert.equal(matchEventFilter({}, event), true);
  });

  it("matches when equality matches on single or nested payload fields", () => {
    assert.equal(
      matchEventFilter({ "payload.status": "pending" }, event),
      true,
    );
    assert.equal(
      matchEventFilter({ "payload.amount": 150 }, event),
      true,
    );
    assert.equal(
      matchEventFilter({ "payload.customer.tier": "gold" }, event),
      true,
    );
    assert.equal(
      matchEventFilter(
        { "payload.status": "pending", "payload.customer.tier": "gold" },
        event,
      ),
      true,
    );
  });

  it("does not match when value differs or field is missing", () => {
    assert.equal(
      matchEventFilter({ "payload.status": "completed" }, event),
      false,
    );
    assert.equal(
      matchEventFilter({ "payload.missingField": "value" }, event),
      false,
    );
    assert.equal(
      matchEventFilter({ "payload.customer.tier": "silver" }, event),
      false,
    );
  });

  it("does not match if filter targets outside payload", () => {
    assert.equal(
      matchEventFilter({ "eventName": "order.created" }, event),
      false,
    );
  });
});

describe("Execution event envelope builder", () => {
  it("builds the approved execution envelope with eventId, source, eventName, and payload", () => {
    const eventId = new Types.ObjectId();
    const tenantId = new Types.ObjectId();

    const event = {
      _id: eventId,
      tenantId,
      eventName: "order.created",
      payload: {
        orderNumber: "ORD-999",
        status: "pending",
        amount: 500,
      },
    };

    const envelope = buildExecutionEventEnvelope(event);

    assert.deepEqual(envelope, {
      eventId: eventId.toString(),
      eventName: "order.created",
      source: "business_events",
      payload: {
        orderNumber: "ORD-999",
        status: "pending",
        amount: 500,
      },
    });

    // Ensure envelope payload has no _id or tenantId
    assert.equal((envelope.payload as any)._id, undefined);
    assert.equal((envelope.payload as any).tenantId, undefined);
  });
});

