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
| Quiet hours | Midnight–06:00 Pacific; manual checks may use the shared window allowance |
| Scheduled-window ceiling | $1, shared by automatic continuations and manual checks |
| Monthly warning | $10 of tracked costs plus outstanding holds |
| Monthly email-analysis ceiling | $15; resets on the UTC calendar-month boundary |
| Call-count limits | No daily, rolling, or monthly call-count gate for batch analysis; counters remain diagnostic |
| Website lookup | Separate maximum of 40 searches per UTC month; outside email-analysis spending |
| Budget ownership | Shared across all connected users, not per employee |

A minute-based dispatcher selects due connections and continues queued work within the dollar allowance. A manual button run performs up to three steps. Connecting a mailbox may initiate a manual scan. Manual checks share the current scheduled window rather than opening a new $1 allowance. Before 06:00, a manual check uses the previous 21:00 window. Queued work remains saved if a limit prevents another request; a dollar budget cannot guarantee every queue clears.

Each paid batch atomically reserves $0.50 before dispatch, using the monthly usage row lock and a once-only job reservation. This exceeds the maximum GPT-4.1-mini input-context cost plus the configured 6,000 output tokens at the versioned rates. Reported cost replaces the hold; failed or unpriced requests retain it. A request is blocked unless both the remaining window and month can cover the whole hold, so scanning can pause below the nominal ceiling. If the model, context size, output limit or pricing changes, review the reservation amount before deployment.

Monthly accounting includes recorded email-analysis costs from earlier in the month, including the October 11 catch-up. Historical requests without cost reporting or a reservation are explicitly excluded; they cannot be reconstructed as zero-cost usage. Costs are estimates based on `supabase/functions/sot/batches.ts`, not a provider invoice. Website lookups and other services are excluded. The $15 ceiling therefore applies to tracked email analysis, not the entire provider account. Settings are private server-side data; only service-role budget RPCs can reserve spending.

## Security and verification

OAuth refresh credentials are encrypted server-side. Gmail permission is read-only. App requests verify active staff authentication; the Google callback uses hashed, single-use, expiring state. Queue payloads, job answers and receipts are not readable through authenticated table access. Review operations are scoped to the signed-in mailbox; owner project review is separately authorized and audited. Completed job payloads are cleared.

Tests exercise migrations, permissions, approvals, retries, evidence validation, budget helpers and regressions. They do not establish live model accuracy or reproduce concurrent production database sessions. Release checks require a current backup, all migrations through `20261015000000_sot_dollar_budget.sql`, matching SOT function files, and the frontend. See [deployment](../DEPLOY.md). Do not substitute a successful frontend build for a server type check or live verification.

Size-only legacy deferrals return to automatic processing. Uncertain paid failures remain available for deliberate recovery. Existing budgets and identity/evidence checks remain in force.

Repair validation notes: confirmed-client conversations take priority over unrelated mail, then newest messages first. Evidence comparison ignores email reply-prefix formatting and typographic quote variants, but still requires the same contiguous words. Diagnostics record rejection codes, lengths and boolean validation flags, never proposal or email contents.

## October 11 live repair

The combined conversation pass now applies the task-pass instructions and excludes `client` from the response schema whenever an existing-client relationship is present. Contact and source identifiers are constrained to supplied values. The response contract requires contiguous source quotes and real task IDs for updates/completions.

A new task may represent outstanding or ongoing unfinished work; completed, cancelled and unknown work remain excluded. Its primary evidence must occur in its cited message. Project, deadline and estimate evidence can come from another supplied message in the same conversation, but each must still match a real passage. This lets a later request retain the project context established earlier in the thread.

The temporary October 11 repair-call exception and private diagnostic copies are operational debugging only, not permanent budget or retention policy changes.

SOT suggestions remain proposals for the user, not automatic decisions. Inferred preparation work from a meeting invitation remains reviewable, with a visible caution that preparation was not explicitly requested. Users choose Add, Edit before adding, or Delete. Valid evidence and identity checks still distinguish the email's actual facts from inferred scope.

One-time catch-up execution and spending verification: [October 11 backlog run](SOT_BACKLOG_RUN_2026-10-11.md).

## Shared work editor

SOT Edit before adding, client Add action/task editing, project editing, and the all-tasks page use `WorkEditor`. Pending suggestions can be classified as client, project, task or subtask; category changes preserve the draft. Existing update/completion suggestions also retain their original action as an option. Save reclassification and acceptance atomically through `sot_editor_submit`, with stale-review checks, role enforcement and acceptance replay protection. Original evidence stays attached and category changes are audited.

Client/project/parent-task creation and teammate setup stay inside the editor. Explicitly created records persist even if the outer draft is cancelled; selectors immediately select the saved record. Client/project/teammate creation remains owner/admin-only. A task requires a specific client project; a subtask requires a parent in that project.

Existing tasks can move between projects and become/reparent/promote subtasks within their original client. Their IDs and recorded time remain intact. Running clocks, nested subtasks and moving a main task with children underneath another task are rejected. Existing projects retain their entity type and client; converting an established project to a task, or moving established work across clients, is not provided by this release. Actual hours remain derived from time records; corrections use Time tracking. Local-only legacy mode retains its earlier task form.


## Optional deadline validation (October 12)

A malformed model-supplied deadline no longer discards an otherwise supported proposal. The validator clears the date and its date evidence and adds a visible uncertainty note asking the reviewer to check the source and choose a date. It does not guess dates from EOD or timestamps. Valid dates still require source evidence. Source quotation, client identity, update-target, duplicate, and permission checks remain in force. This change does not broaden suggestion extraction or alter the eight-proposal limit, budgets, schedules, or contact/vendor capture. Previously reviewed messages are not automatically rescanned.
