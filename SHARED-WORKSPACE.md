# Shared workspace rollout

This branch connects the existing SunRose screens to shared Supabase storage. The migration was applied to the existing Supabase project on September 23, 2026. GitHub Pages publication and real-account browser acceptance checks are still pending.

## What changes

- Cloud mode uses individual database writes and reports success after the server accepts them. Offline mode retains browser storage and stays separate.
- Team accounts come from Supabase profiles. New signups start without business-data access; the owner assigns access. Deactivating a member preserves historical hours.
- Server timers allow one timer per person. Switching tasks saves the previous timer atomically. Stopping twice does not duplicate hours; a stale stop cannot close a newer timer. Forgotten timers can be corrected with an end time and reason.
- Time records are voided with a reason instead of deleted. Audit history is retained. Tasks with time records, clients with tasks, and profiles are protected from hard deletion.
- Retainer calculations use billable time worked in the month (UTC), prorate entries across month boundaries, and exclude already-worked hours from remaining estimates.
- Tasks are private by default. Both signed-in clients and share-link visitors receive selected task titles, statuses, and deadlines. Raw descriptions, time records, team records, and other clients’ work are not exposed to clients.
- Client links are bearer links: anyone holding a link can view that client’s deliberately shared tasks and submit requests. Owners can rotate links. Requests enter the backlog needing approval. A per-client limit of 20 requests/hour is included; this is not a full anti-abuse service.
- Visible staff dashboards check a small revision value every 30 seconds and only refetch the workspace when it changes. No paid AI service, always-running application server, or media hosting was added.

## Validation

The production build and 19 automated tests passed. Tests execute the real SQL migrations, policies, functions, and triggers using local PostgreSQL through PGlite. They cover client separation, narrow client responses, self-promotion prevention, team assignment, timer persistence and retries, stale stops, forged time entries, preserved history, deactivation, request retries, link rotation, migration reruns, and monthly-hour calculations.

Browser checks against a local PostgreSQL-backed API adapter verified owner sign-in and task assignment; employee sign-in, shared task access, timer start, persistence through reload, and saved time; and the anonymous client view and request submission. The adapter simulates Supabase authentication and HTTP responses. It does not prove live Supabase integration, account emails, deployment configuration, or concurrent database connections. Real-account browser sign-in, email links, deployment, and concurrency still require rollout checks. Live SQL checks additionally verified employee task access, timer start/stop and saved time, anonymous raw-task isolation, and invalid-link rejection. Test writes were rolled back. Existing account roles and all original rows were retained; row-level security is enabled on all nine application tables.

## Apply through Cursor / GitHub

Base commit: `0af07708bb7494a03b1b4e24f0eabcfd7fef47f1`. Preserve newer or uncommitted work before applying the patch. Use `git apply --check` against the matching checkout first. The ZIP contains the source, without credentials, installed dependencies, or generated builds.

1. Review `supabase/migrations/20260923000000_shared_workspace.sql`. It preserves rows, replaces the application access policies, adds timers/auditing, and grants narrowly scoped client-link functions to anonymous visitors.
2. Export the existing schema and data using Supabase-supported backup tooling before changing the live database. A workspace JSON download is not a complete database backup.
3. On the existing project, apply only the new migration in the SQL editor. For a fresh database, apply both migrations in filename order. Do not rerun the old profiles migration afterward: it reinstates old access policies.
4. Preserve the existing owner and employee profiles. Missing profiles are backfilled as clients with no business access. No owner account needs to be invented or automatically promoted.
5. Supply `VITE_SUPABASE_URL` and the publishable/anon key in the build environment. Never put a service-role key in frontend code or commit secret credentials.
6. Set Supabase’s authentication Site URL to the actual published app URL, retaining the app and local development redirect allowlist. Test account confirmation and recovery links.
7. Run `npm ci`, `npm run build`, and `npm test`. For the current Pages path, use `VITE_BASE=/SunRose-Dashboard/` in the production build.
8. Test owner and employee accounts in separate browser profiles against Supabase: create a sample client/task, assign it, record time, refresh both browsers, and verify the owner’s record. Check client isolation, corrected timers, and revoked links.
9. Publish after the live checks pass. Retain the previous frontend build. Reverting the frontend alone does not revert database policies; prefer a forward fix, or a verified database backup if rollback is necessary.

## Local preview

Development only, in two terminals:

```sh
node tests/preview-server.mjs
VITE_SUPABASE_URL=http://127.0.0.1:54329 VITE_SUPABASE_ANON_KEY=local-preview npm run dev -- --host 127.0.0.1 --port 5174
```

Fake accounts: `owner@example.test`, `employee@example.test`, `client@example.test`. Fake password: `sunrose-preview-only`. The preview database resets on server restart. The adapter binds to loopback and must never be deployed.

## Limits and remaining work

- Real-account browser acceptance testing and publishing are pending. No paid services were activated.
- Gmail/AI intake, invoicing, and Clockify history imports are not included.
- Cloud backup imports are disabled to prevent a browser snapshot from replacing shared work. Existing offline data needs an explicit migration.
- Employees can work across agency clients. This milestone separates clients from each other; it does not restrict each employee to specific clients.
- Existing logged time takes precedence over legacy manual task totals.
- Monitor storage and transfer against the actual free-plan limits. Audit rows and timer-request history grow over time; establish retention without deleting required time history.

## Parent tasks and subtasks

Apply `20260930010000_subtasks.sql` after the prior migrations. Existing tasks retain their data and start without a parent. A subtask belongs to one top-level task in the same client; changing its parent, deeper nesting, and deleting a parent with remaining children are rejected by the database.

The task list expands parents into their subtasks. Each subtask has an independent assignment, month, due date, completion control, and timer. Parent progress and estimates are calculated from children; actual hours also include earlier time recorded directly against the parent. Retainer usage counts each entry once, and committed estimates exclude the parent when children exist. A parent is included in a month when any child belongs to that month. The calendar can include subtask deadlines and links to the appropriate parent/month.

Stop a running parent timer before adding its first subtask. Once children exist, new time must be recorded on a subtask; existing parent time and its audit history remain. Subtasks are private by default. A shared parent exposes aggregate progress; child details require both parent and child to be shared. Signed-in clients use the same restricted projection. No internal descriptions or time records are added to client responses.

Templates still create individual tasks; whole-project templates are a later extension. Browser acceptance used the local Supabase adapter, including a parent, two assigned subtasks, completion rollup, and client privacy. Automated database and calculation tests cover cross-client links, nesting, deletion restrictions, timers, historical time, cross-month work, privacy, and migration reruns. Live concurrent-user acceptance remains recommended before onboarding the full team.
