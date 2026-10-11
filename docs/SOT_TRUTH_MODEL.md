# SOT: current behavior and budget contract

[Documentation home](README.md) · [Setup](SOT_SETUP.md) · [Recovery](SOT_RECOVERY.md)

## Goal and authority

SOT assembles an evidence-backed picture of SunRose's work: **Client → Project → Task → Subtask**. It seeks factual scope and outstanding commitments, not the largest possible task count. Email, signatures, prior summaries and model output are untrusted evidence, never instructions to execute. Nothing becomes official without human review.

Confirmed client contacts, domains, aliases and owner-maintained context guide identity matching. An existing client in the participants or text is considered before a new client. Sponsors, venues and vendors mentioned in that relationship are not automatically clients. Multiple possible clients remain ambiguous for human review.

Suggestion types are client, project, task (including subtask), update, and completion. Projects are independent proposals; approving one never accepts its tasks. Repeated events on different dates remain distinct. Tasks require a specific approved project; “General” is not an assignable project. Completion needs evidence of delivery, not a promise. Unknown, cancelled and already completed work must not become new tasks. Exact source quotations support proposals; dates and estimates require their own cited evidence.

Internal SunRose emails can support work for an existing client identified by the supplied relationship context. They cannot establish a new client without an external participant, and internal addresses are never saved as client contacts.

## People and review

Active owners, admins, supervisors and employees may connect Gmail. Each person reviews their own work suggestions. Accepted tasks default to that person and start private; Edit before adding can explicitly select another active teammate. Owners and supervisors receive notifications. Selecting an assignee does not transfer the mailbox connection or suggestion ownership. Owner/admin approval is required for projects. The Overview owner review inbox exposes other staff members' project proposals, allowing approval without impersonating them. Related tasks remain pending under the originating reviewer. Support view stays read-only.

Client share requests enter a separate intake table and appear in the owner review inbox. An owner/admin selects a client project to create a task, or dismisses the request. New tasks start private and assigned to the reviewer. Intake is idempotent and limited to 20 requests per client per hour. Anonymous visitors cannot read the intake table.

## Collection and analysis

Gmail access is read-only. Routine discovery starts with seven days of inbox/sent mail; later collection overlaps its watermark by one day. A returned thread can contain up to 90 days of context. Attachments and Google Docs are not read. This is not an exhaustive mailbox archive.

Collection and analysis have separate checkpoints. Unreviewed messages persist in a server-only queue. Retrieval failures use a separate retry record retaining the original collection window; they never overwrite queued evidence. A step collects up to three listed conversations plus two failed retrievals. Successful retrieval retries are removed; failures remain eligible for subsequent checks.

One conversation is analyzed per synchronous model request. Recent queued messages take priority; a checkpointed conversation is finished before starting another. Each step makes at most one paid analysis request. A step with no eligible work uses no analysis call.

Ordinary conversations are sent together, up to 192,000 serialized bytes of messages. Larger conversations use resumable sections, retaining unconfirmed candidates until later replies have been checked. Nothing is published until the final section. Input is bounded to 208,000 UTF-8 bytes including workspace context, with explicit omission counts. Full matching client tasks/projects remain available for server-side duplicate checks.

Source identifiers are constrained to the supplied email IDs. Output is limited to 6,000 tokens; incomplete answers and uncertain paid failures retain a specific failure reason for recovery. Completed jobs retain proposed and validated counts plus rejection reasons. A saved answer or checkpoint can be resumed without paying again. Publication and message receipts commit atomically. Full queued text remains until processing completes.

## Recovery and memory

The SOT page offers message selection and **Queue retry**, or **Mark handled manually** with a reason. Retrying only queues work; the same budget applies when analysis runs. An uncertain earlier request may already have been billed. Long messages are sectioned automatically; manual resolution remains available when human judgment is needed. Unselected messages remain in review. Manual resolutions are counted separately from AI-reviewed messages. Recovery actions are audited and cannot race an active scan.

An unchanged completed message is not reanalysed automatically. New task identities distinguish client, project, parent, title and deadline. Updates/completions additionally distinguish the cited message and change content, so a later instruction is not permanently suppressed by an earlier update. Exact replay stays idempotent. Accepted/dismissed history is retrieved as context, not model training; dismissal without a reason does not blacklist a client.

Previously discarded evidence cannot be reconstructed from an empty queue row. Legacy empty review entries can request retrieval from Gmail. Already completed historical scans are not automatically rescanned by this release.

## Shared budget — authoritative rules

| Control | Value |
|---|---|
| Automatic slots | 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 America/Los_Angeles |
| Quiet hours | Midnight–06:00 Pacific; manual checks may use available reserve |
| Released allowance | 3 additional calls per slot; unused allowance carries within that Pacific day |
| Automatic daily maximum | 18 |
| Manual reserve | 2 additional calls, within the total daily maximum |
| Total daily maximum | 20; resets at Pacific midnight |
| Rolling maximum | 10 calls in three hours |
| Monthly analysis maximum | Configured cap; default 600; resets on UTC month boundary |
| Website lookup | Separate maximum of 40 searches per UTC month |
| Budget ownership | Shared across all connected users, not per employee |

A minute-based dispatcher selects due connections and continues queued work within the released allowance. A manual button run performs up to three steps. Connecting a mailbox may initiate a manual scan. Failed/uncertain reserved requests count. Atomic reservations serialize on the monthly usage row and reserve a job only once.

These are call limits, not a dollar spending guarantee. The 600-call cap takes precedence over the daily allowance: using 20 calls on all 31 days would require 620. More connected mailboxes share capacity and may increase waiting time. No audit fix increases these limits or starts a paid scan.

Cost estimates use the versioned rates in `supabase/functions/sot/batches.ts`. They cover reported token usage since batching began, exclude old unmetered requests, website lookups and other services, and expose the number of requests without reported usage. They are not an invoice.

## Security and verification

OAuth refresh credentials are encrypted server-side. Gmail permission is read-only. App requests verify active staff authentication; the Google callback uses hashed, single-use, expiring state. Queue payloads, job answers and receipts are not readable through authenticated table access. Review operations are scoped to the signed-in mailbox; owner project review is separately authorized and audited. Completed job payloads are cleared.

Tests exercise migrations, permissions, approvals, retries, evidence validation, budget helpers and regressions. They do not establish live model accuracy or reproduce concurrent production database sessions. Release checks require a current backup, all migrations through `20261013000000_audit_reliability.sql`, matching SOT function files, and the frontend. See [deployment](../DEPLOY.md). Do not substitute a successful frontend build for a server type check or live verification.

Size-only legacy deferrals return to automatic processing. Uncertain paid failures remain available for deliberate recovery. Existing budgets and identity/evidence checks remain in force.
