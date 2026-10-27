 # Workflow & Saga Orchestration Engine

## Project Overview
A team project to build a workflow orchestration platform that executes multi-step workflows, tracks execution status, and handles failures.

## Project Status
Initial repository setup.

## Planned Technology Stack
- Frontend: React
- Backend: Node.js and Express.js
- Database: MongoDB

## Team
Four-member internship team.

## Development Approach
- Work through individual Git branches.
- Test changes before merging.
- Document setup instructions and implementation decisions.
- Add features incrementally and verify them before marking them complete.

## Current Scope
Requirements analysis and project setup. Implementation details are pending confirmation against the official project brief.

## Workflow Execution

The backend defines tenant-authenticated endpoints for requesting workflow executions and retrieving execution history and execution details. Execution requests are currently unavailable because no execution worker is configured. Browser end-to-end verification is pending.

## Backend Test-Tenant Provisioning

To create or safely re-check the two isolated tenants for authorized workflow
verification, configure `MONGODB_URI` in `backend/.env` or the process
environment. It must point to the isolated MongoDB database named exactly
`test`; do not use a production connection. Run from the `backend/` directory:

```sh
NODE_ENV=test ALLOW_TEST_TENANT_SEED=true npm run seed:mahak-test-tenants
```

Both `NODE_ENV=test` and the explicit `ALLOW_TEST_TENANT_SEED=true` opt-in are
required. The script also checks the actual connected MongoDB database name
before writing. The provisioning service is invoked only by this dedicated
`seed:mahak-test-tenants` script; the normal test and application commands do
not provision tenants. Never run this provisioning command against a
development or production database. To run the fake-backed unit tests without
connecting to MongoDB, run this from `backend/`:

```sh
npx tsx --test src/services/testTenantProvisioning.service.test.ts
```

The complete backend suite is `npm test`.

The script creates `Mahak Test Tenant A` and `Mahak Test Tenant B` with
independent API keys, verifies that each newly created key resolves to its own
tenant, and stores only the API-key hashes. Existing active keys are not
rotated, revoked, or displayed; rerunning the command does not issue extra keys.
Plaintext keys are shown only during the run that creates them and cannot be
recovered by rerunning the script.

Run the command in a private terminal and do not save its output in the
repository, shell history, logs, screenshots, or chat. Copy each newly displayed
key directly into the team's approved secret-sharing mechanism and share it
only with the authorized developer, paired with its tenant name and ID. Do not
send keys through ordinary email or chat, and do not add them to source,
documentation, fixtures, or Git commits. If a key is lost, have an authorized
operator revoke it and arrange a controlled replacement rather than attempting
to recover it from the database.
