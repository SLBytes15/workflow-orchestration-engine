# Workflow API — Tenant Authentication Contract

## Status

**Contract decisions pending; current REST authentication baseline implemented.**

The current branch has database-backed API-key authentication and tenant-scoped
workflow/execution routes. This does not establish that all production
authentication policy, operational controls, or live-database integration
requirements are complete.

## Existing implementation

- `backend/src/services/tenantResolver.ts` hashes the presented API key with SHA-256 for lookup, rejects non-active, revoked, or expired keys and inactive/missing tenants, and returns the persisted tenant ID.
- `backend/src/middleware/tenantAuth.middleware.ts` reads `x-api-key` and attaches only the resolved tenant ID to server-side request context.
- `backend/src/middleware/tenantContext.middleware.ts` validates the format of a client-supplied `x-tenant-id`; this does not establish authorization.
- The legacy `/api/test-tenant` endpoint uses the development-only in-memory `tenantMiddleware`/`apiKeyResolver`; workflow and execution REST routes use `tenantAuthMiddleware` and the database-backed resolver instead.
- `/api/health` does not require authentication; it remains subject to the `/api` rate limiter.
- This is REST authentication only; no WebSocket ticket-authentication endpoint or handshake is implemented.
- `backend/src/models/tenant.model.ts` is the canonical Mongoose Tenant model.
- `backend/src/models/workflow.model.ts` is the canonical Mongoose Workflow model.
- `backend/src/models/index.ts` exports TypeScript types, not the Mongoose models.
- `backend/src/config/database.ts` owns the existing database connection setup.

Do not duplicate or replace the existing models or connection module.

## Required trusted request context

The current REST middleware resolves the API key to a persisted active Tenant and attaches its MongoDB ObjectId to trusted server-side request context. The following remain requirements for policy review and production readiness:

Policy and coverage requirements:

- The identity must originate from successful authentication and tenant mapping.
- A client-supplied `tenantId` or `x-tenant-id` must not establish authorization.
- The ObjectId must identify the persisted Tenant document.
- The current resolver rejects inactive tenants; any policy change must be explicit.
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