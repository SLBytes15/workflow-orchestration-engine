# Workflow API — Tenant Authentication Contract

## Status

**Proposed — pending team agreement.**

Production API-key authentication and MongoDB-backed workflow operations are blocked until the API-key contract is finalized.

## Existing implementation

- `backend/src/services/apiKeyResolver.ts` contains a development-only in-memory API-key resolver.
- `backend/src/middleware/tenant.middleware.ts` uses that resolver and attaches a development tenant context.
- `backend/src/middleware/tenantContext.middleware.ts` validates the format of a client-supplied `x-tenant-id`; this does not establish authorization.
- `backend/src/models/tenant.model.ts` is the canonical Mongoose Tenant model.
- `backend/src/models/workflow.model.ts` is the canonical Mongoose Workflow model.
- `backend/src/models/index.ts` exports TypeScript types, not the Mongoose models.
- `backend/src/config/database.ts` owns the existing database connection setup.

Do not duplicate or replace the existing models or connection module.

## Required trusted request context

After the authentication contract is approved, middleware must resolve the API key to an authorized, persisted Tenant document and attach its verified MongoDB ObjectId to trusted server-side request context.

Requirements:

- The identity must originate from successful authentication and tenant mapping.
- A client-supplied `tenantId` or `x-tenant-id` must not establish authorization.
- The ObjectId must identify the persisted Tenant document.
- Inactive-tenant handling must follow an agreed policy.
- Authentication failures must fail closed.

## Required service interfaces

The workflow service should receive the authenticated tenant ObjectId explicitly.

Proposed operations:

- `createWorkflow(tenantObjectId, validatedInput)`
- `listWorkflows(tenantObjectId)`

These signatures are illustrative. The exact TypeScript types and error contract remain to be agreed.

Every tenant-owned database query must be scoped to the authenticated tenant. Read, update, and delete operations must not expose or modify another tenant's data.

## Initial workflow API

### POST /api/workflows

Accepts `name`, optional `description`, and a validated `graph`.

- Reject client-supplied `tenantId`, `version`, and `status`.
- The server assigns initial status `draft` and version `1`.
- Tenant ownership comes from trusted authentication context.

### GET /api/workflows

Returns only workflows owned by the authenticated tenant.

### PUT /api/workflows/:workflowId/graph

Replaces the graph for a workflow owned by the authenticated tenant.

- Requires the tenant API-key authentication used by the other workflow routes.
- Accepts only `{ "graph": WorkflowGraph }` and validates the existing graph
  structure before updating.
- The database update filters by both workflow ID and authenticated tenant ID.
- Successful graph updates increment the workflow version.

### DELETE /api/workflows/:workflowId

Deletes a workflow owned by the authenticated tenant.

- Requires the tenant API-key authentication used by the other workflow routes.
- Validates the workflow ID before attempting deletion.
- The database delete filters by both workflow ID and authenticated tenant ID.
- Missing workflows and workflows owned by another tenant return the same
  `404 WORKFLOW_NOT_FOUND` response.

## Decisions required before production authentication

The team must agree on:

1. API-key generation and entropy requirements.
2. Secure key storage and verification.
3. API-key-to-Tenant mapping.
4. Rotation and revocation.
5. Inactive-tenant behaviour.
6. Trusted request-context types.
7. Authentication error responses and logging.
8. Integration-test database strategy.

## Test plan

Tests must cover missing and invalid keys, unresolved tenant mappings, tenant-scoped creation and listing, cross-tenant access denial, and rejection of client-supplied tenant identifiers.

Production authentication and persisted workflow operations must not be considered complete until the contract is approved and the required tests pass.