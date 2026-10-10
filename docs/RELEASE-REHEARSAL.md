# Project and time-tracking release rehearsal

Validated October 9, 2026, for draft PR #14. No production migrations or publication were performed during this rehearsal.

- 104 automated tests pass; TypeScript and production build pass.
- The restore test creates a baseline database with synthetic accounts, task, historical time and an active timer, takes a physical PGlite snapshot, and verifies every application/auth table after restoration.
- All six pending migrations are then applied. Task assignment, historical time, and active timer survive project backfill. A locked pay period survives a second backup/restore and still prevents corrections; private rates retain access restrictions. The baseline backup also restores independently.
- Local browser smoke checks verified owner sign-in, Overview, Tasks and Time Tracking navigation, reporting periods, and pay-period controls using the full migration set. Authentication is simulated by the local adapter; this does not verify production Supabase authentication or concurrent connections.
- Corrected minimum-minute entries in time reports and historical project attribution after moving a task. Support view now includes read-only time tracking and project timer labels.

## Live release gate

Supabase's production Backups page reports that the Free plan does not include project backups. No live backup has been created or restored by this rehearsal. A workspace JSON export is not a complete database backup.

Before applying changes, obtain a protected schema/data backup using supported database tooling and verify restoration in a separate database. Keep credentials and exports outside Git. Then apply migrations 20261010010000 through 20261010060000 in filename order, deploy the matching SOT function, and publish the matching frontend. Verify real owner/employee access, timers, suggestions, client isolation and pay-period permissions. Do not run a paid SOT scan simply as a release check.

Retain the prior frontend artifact and verified database backup. Prefer a forward fix; reverting the frontend alone does not reverse schema or policy changes. Payroll exports are recorded hours/base-pay estimates, not tax, overtime, deduction or payment processing.
