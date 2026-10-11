# Validate and deploy SunRose

[Documentation home](docs/README.md) · [SOT setup](docs/SOT_SETUP.md) · [Audit remediation](docs/AUDIT_REMEDIATION.md)

## Release sequence

1. Review the branch and run `npm ci`, `npm test`, `npm run build`, and `deno check supabase/functions/sot/index.ts`. Frontend TypeScript does not check server files. The root `deno.json` enables automatic resolution of SOT’s pinned npm dependencies, which may differ from the frontend lockfile. Tests run locally without paid API calls.
2. Before changing production schema, create a protected **database schema/data backup**, record the current source revision, and verify restoration in an isolated database. A browser JSON export or Git snapshot alone is not a database backup. Keep backup files and credentials outside Git.
3. Check the production migration history. Apply only unapplied migrations in filename order. The audit release added `20261013000000_audit_reliability.sql`. The inline-review release adds `20261014000000_inline_review.sql` after it; both preserve existing tasks, time entries and budgets. The dollar-budget release adds `20261015000000_sot_dollar_budget.sql`, replacing the analysis call gates with $15/month, a $10 warning and $1 scheduled-window limits; no new SOT function deployment is required for this SQL/frontend-only change. The shared-editor release adds `20261016000000_shared_work_editor.sql` before its matching frontend; it preserves record IDs and permits safe leaf-task reparenting. Never rerun the original profiles migration over a current installation—it can restore obsolete policies.
4. Deploy the entire `supabase/functions/sot` directory, including `context.ts`, `validation.ts`, and `team.ts`. Preserve existing server secrets and `supabase/config.toml`. Google OAuth callbacks cannot supply the gateway JWT; application routes validate staff authentication themselves.
5. Publish the matching frontend through a reviewed merge to `main`. GitHub Pages must use **GitHub Actions** as its publishing source. The workflow runs the test suite and SOT server type check before deploying.
6. Verify the actual published revision and perform the release checks below. Record what was observed, separately from local tests. Never report a deployment as complete based only on a local build.

## Configuration

GitHub Actions build secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public/anon, never service role). The workflow supplies `VITE_BASE=/SunRose-Dashboard/` from the repository name. Production uses hash routes under `https://arrowfinder.github.io/SunRose-Dashboard/`.

Use the existing Supabase project and account roles. Auth site/redirect URLs must match intended deployment and local development URLs. Do not recreate owner accounts or change role assignments as part of deployment.

SOT's server secrets and Google OAuth setup are documented in [SOT setup](docs/SOT_SETUP.md). The minute dispatcher is in `supabase/deployment/schedule_sot.sql`; its Vault secret must match the function's scheduler secret. The function, not the cron interval, enforces the six Pacific analysis slots. Replacing an existing named schedule should be deliberate and verified.

## Audit-release acceptance checks

- Owner and employee sign-in; client isolation and read-only support view.
- Client-link request is saved once, visible in the owner inbox, and becomes a task only after choosing a valid project.
- Owner approval of an employee project links pending suggestions without accepting tasks or changing their reviewer.
- A failed Gmail retrieval preserves queued content. Recovery can queue selected messages, retain the remainder, or audit a manual resolution.
- An updated instruction for the same task can appear separately; exact replay remains idempotent.
- Historical time can be corrected after a task move; protected pay periods and permissions still reject unauthorized edits.
- Read the current queue/budget/status and scheduler records. A paid real scan needs intended mailbox/spending authorization; deployment does not require one automatically.

## Rollback and troubleshooting

Pause automatic SOT checks before a coordinated server/database recovery. Retain new intake/recovery records and the pre-release backup; do not drop additive tables as a routine rollback. Assess compatibility before reverting only the frontend or function. Database restoration is a separate approved recovery action that can replace newer business data.

A Pages build failure now includes failing tests. Fix the failure rather than bypassing the gate. For Pages environment restrictions, allow the intended `main` deployment under the existing review policy; do not remove review protections merely to force publication. A blank frontend often indicates incorrect base-path/build configuration. Google return failures require checking the exact callback URI and server configuration, without exposing secrets.
