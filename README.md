# SunRose Dashboard

SunRose's shared workspace for **clients → projects → tasks → subtasks**, calendars, time tracking, pay-period review, and SOT email suggestions. Client-facing views expose only deliberately shared work.

**[Documentation home](docs/README.md)** · [SOT behavior and budgets](docs/SOT_TRUTH_MODEL.md) · [Recovery and review](docs/SOT_RECOVERY.md) · [Deployment](DEPLOY.md) · [Audit fixes](docs/AUDIT_REMEDIATION.md)

## Local development

Use Node.js 24 and install dependencies with `npm ci`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in an ignored local environment file, then run `npm run dev`. Use only the public/anon key in frontend configuration. Server credentials and database backups must remain outside Git.

Without Supabase configuration the app uses its separate local prototype storage. That mode is not the shared agency dashboard and does not provide Gmail scanning or production cloud permissions. Never use local prototype data as evidence that production database behavior works.

## Checks

- `npm test` runs database, authorization, budget and application regression tests using local PGlite and TypeScript helpers. It does not call Gmail or OpenAI.
- `npm run build` checks frontend TypeScript and builds the site.
- `deno check supabase/functions/sot/index.ts` separately checks the server entrypoint and its imports.

GitHub Pages deployment runs tests and checks SOT server types before publishing. Database migrations and the SOT server deployment are separate steps; see [deployment](DEPLOY.md). Do not publish frontend changes requiring a migration before the database/server are ready.

## Access and workflows

New signups require a name and start without assigned business access. Owners/admins manage access. Staff roles are owner, admin, supervisor and employee; clients see only their assigned shared view. Owner/admin support viewing is read-only.

SOT connects staff Gmail with read-only consent. People review suggestions; projects require owner/admin approval. The Overview owner review inbox includes employee project suggestions and client requests awaiting project assignment. All connected mailboxes share the SOT budget. See the [single current contract](docs/SOT_TRUTH_MODEL.md) for exact limits and exclusions.

Time entries preserve their historical project association when a task moves. Corrections are audited. Submitted/approved/locked pay periods require authorized reopening before edits. Reports are recorded hours and base-pay calculations, not processed payroll or tax calculations.

Historical implementation receipts are linked from the documentation home. They are retained as history, not current deployment instructions.
