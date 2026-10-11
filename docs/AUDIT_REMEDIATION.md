# Audit remediation: eight reliability findings

[Documentation home](README.md) · [Current SOT contract](SOT_TRUTH_MODEL.md)

This change addresses the repository audit performed October 10, 2026. Implementation and local verification are distinct from production publication. See the release/PR record for the deployed revision; this document is not a claim of live deployment.

| Finding | Correction | Regression coverage |
|---|---|---|
| P1: retrieval failure erased queued evidence | Separate durable fetch-retry records retain the collection window and never overwrite the mail queue | Existing payload, age and fingerprint unchanged after repeated retrieval failures; retry table inaccessible to staff |
| P1: focused review had no exit | Own-mailbox recovery selects messages for budgeted retry or records a manual resolution; retains remainder and audits action | Ownership, active-scan exclusion, oversized selections, missing payload, incomplete publication, remaining messages and manual receipts |
| P1: later updates suppressed as duplicates | Update/completion identities include source message and change evidence/content | Distinct instructions coexist; identical replay is stored once |
| P1: client requests lacked a required project | Separate client intake; owner/admin assigns a project before task creation | Anonymous submission, idempotency, intake privacy, approval permission and valid project |
| P2: employee project suggestions unapprovable | Owner/admin review inbox and privileged cross-user project approval | Employee denied; owner can approve; tasks remain pending under original reviewer |
| P2: internal client work rejected | Internal participants allowed for context-confirmed existing client work, not new-client discovery | Validation/acceptance path; no internal address saved as client contact |
| P2: moved-task time edits failed | Preserve existing historical association for corrections; validate new associations normally | Note correction preserves old project; another employee cannot edit it; existing payroll lock tests remain |
| P2: global newest-300 context cutoff | Paginate relevant client work before ranking bounded model context | More than 1,200 records retained; old relevant work selected; failed context fetch fails closed |

New regression suite: `tests/auditReliability.test.ts`. Existing tests continue covering payroll locks, task hierarchy, sharing, permissions, budgets, approvals and backup/restore. Tests use a local database and mocked/helper data, not live emails or paid model requests. Production concurrency and model accuracy still require separate observation.

Local verification: all 135 tests, the production build, and the Deno server type check passed. A local browser using sample data verified client intake-to-task creation, owner approval of an employee project, and focused recovery queuing with zero calls consumed. These checks used a simulated local authentication/API adapter, not production Gmail.

The deployment workflow now runs `npm test` and the Deno server type check before publication. Documentation is consolidated under `docs/README.md`; retired SOT descriptions point to one authoritative contract. Existing historical receipts are explicitly labeled.

## Unchanged limits and known boundaries

No budget increase or automatic historical rescan is included. Recovery cannot recreate evidence already erased by earlier code without fetching it again. Very large individual messages require manual Gmail review. Model context remains bounded and semantic interpretation remains fallible. The monthly limit is shared, and token cost reporting is an estimate with documented exclusions.

The migration is additive and transactional. Existing pay-period locks, assignment, client visibility, encrypted credentials and server-only mail storage remain enforced. Deployment requires the matching migration, server files and frontend in that order.
