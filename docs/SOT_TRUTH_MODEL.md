# SOT: evidence, scope and human confirmation

SOT's goal is to assemble an evidence-backed picture of Sunrose's client work, reduce missed commitments and administrative effort, and keep people in control of what becomes official. It does not maximize task count. An empty result is correct when information does not support an action.

This is the current implementation contract. Historical deployment notes describe what was true at their dates; this document takes precedence for behavior.

## Knowledge hierarchy

Client → Project → Task → Subtask.

- Confirmed clients, contacts, domains, aliases and owner-maintained context anchor identity. A venue or sponsor mentioned by an existing client is normally scope context, not a new client.
- Approved projects define distinct engagements, campaigns or ongoing workstreams. Different event dates remain separate projects. General is not an assignable project. Legacy tasks retain their historical references until a person assigns a specific project; the dashboard flags them as Project required.
- A task is a specific outstanding Sunrose deliverable. A subtask belongs to an existing top-level task and inherits its project.
- Source messages provide evidence about requests, delivery and changes. Approval establishes an organizational decision; it does not guarantee an email claim is objectively true or that a task remains outstanding forever.
- Pending suggestions, prior scan summaries and inferred groupings are hypotheses. Never treat an inferred summary as a quotation or an accepted fact.

## Independent suggestion types

1. **Client:** business identity and evidence of a service relationship; no bundled tasks.
2. **Project:** proposed initiative name, scope, client, supporting conversations and uncertainties. Owner/Admin approval creates only a project. Related pending tasks become linked to its ID but remain unaccepted. No billing amount, rate, hours or event deadline is inferred.
3. **Task/subtask:** actionable outstanding work, with a confirmed project selected before acceptance. Each task remains independently editable/approvable.
4. **Update:** material new information for a specific supplied task ID; approval appends information with stale-version protection.
5. **Completion:** evidence of completed delivery for a specific existing task; promises and approvals are not completion. Existing subtasks and running clocks retain their protections.

Project suggestions appear as their own cards, ahead of task suggestions. Adding a task cannot create a project as a side effect. The previous combined approval RPC now returns an explanatory error. An employee can receive a project proposal but only Owner/Admin can create projects. Each person's suggestions remain private; the existing explicit support view is read-only.

## Evidence and contradiction checks

The engine validates a nontrivial quotation against the cited message body. A subject, footer, signature or fabricated quotation is insufficient. Proposals must cite a supplied message inside the current scan window. Dates and estimates require separate supporting quotations; otherwise those fields are cleared. These quotation checks prove text exists, not that a model interpreted it correctly.

Project matching validates same-client references and evidence for dated occurrences. A standalone project requires a confirmed client relationship and a supporting project quotation. Unclear initiative boundaries stay unresolved. Different initiatives mentioned together must be separated only when the evidence supports separate deliverables.

New tasks require `outstanding` work state; completion requires `completed`; updates require `changed`. Explicit sent/completed/cancelled wording in a task's quotation is rejected conservatively. The prompt compares newer sent and received replies, distinguishes stopping promotion from necessary post-event follow-up, and never invents a task to 'confirm whether' work exists just because the model is uncertain.

Existing tasks and the reviewer's saved suggestions are included as bounded context across conversations. Exact task repeats with the same client, project/proposed project, parent and due date are suppressed; close title matches in that same scope are flagged for review. Semantic paraphrases, differing dates and cross-project ambiguity are not safely solved by string matching. They rely on the model comparison and human review. No automatic deletion or completion is performed from a similarity guess.

## Memory and rescans

Project identity uses client plus normalized project name, including any event date. Evidence from additional conversations is collected on the pending project card (up to 12 source entries). Accepted project descriptions are supplied as confirmed scope on later scans. Pending scope and supporting excerpts are explicitly marked unconfirmed in model context.

Scans preserve existing pending corrections, dismissals and approvals instead of deleting a thread's previous suggestions. An empty result does not prove old suggestions are no longer valid. Stale/conflicting pending suggestions may still need manual review. Archived rows are not silently resurfaced by unrelated payload edits.

Accepted/dismissed review history is retrieved as context; it is not model training. Rejection without a reason is not a permanent client blacklist. No claim is made that SOT remembers every email or reconstructs an entire engagement perfectly: message, context and budget limits bound its view.

## Current operating limits

Read-only Gmail inbox and sent mail. Current-work query starts at seven days, then uses a one-day overlap after the last completed scan. Selected threads may include messages from the prior 90 days, with new-content analysis limited to the current seven-day window and oversized work deferred before paid analysis. Unchanged fingerprints skip AI calls. Engine changes reconsider only threads returned by this bounded query, not the whole mailbox.

Known-client mail uses one work-analysis call (projects/tasks/updates/completions); unknown relationships may add a separate client-discovery call. No extra project-only API pass is added. Serialized input stays within 16,000 UTF-8 bytes, output within 2,400 tokens, and each pass proposes at most eight items. Relevant context is selected first. Optional context is trimmed with explicit omission counts; email evidence and carried candidates are not silently truncated. Exact previously quoted blocks may be removed when their original is retained. Signatures and uncertain quoted content are preserved to avoid losing instructions.

The scheduler checks due mailboxes each minute, resumes unfinished batches, and schedules the next completed scan after three hours. Workspace caps remain 10 calls per rolling three hours, 20 per UTC day and the configured monthly allowance (default 300; October's approved exception is 600). Reserved failed calls count. No budget increase or paid scan is part of this change.

No Google Docs, attachments, external links, autonomous outbound messages, invoices or payroll decisions. Website lookup remains a separate optional reviewed action.

## Upgrade and validation

Apply migrations in order through `20261011000000_sot_scan_sections.sql`, then deploy the SOT function and frontend. The migration extracts older embedded project proposals into independent cards and links their pending tasks, preserving originals and marking imported scope as unconfirmed. It does not create official projects or tasks. Existing approved business records and time history are unchanged.

Run `npm test`, `npm run build`, and a Deno type check. Tests cover standalone approval, role/ownership/stale-state controls, retry safety, independent task approval, source validation, exact dedupe, distinct event scopes, evidence aggregation and preserved review decisions. Automated tests do not establish live model accuracy. Validate a bounded real scan with Sierra when ready; distinguish actual observed results from expected behavior.

## Resumable conversation sections

Each invocation performs at most one reserved AI call. Chronological message fragments are grouped into sections of approximately 8 KB before context; serialized requests remain at most 16 KB. Every successful section/pass response is checkpointed in server-only `sot_thread_progress`. Later sections revise the carried provisional candidates; suggestions are published only after all sections and passes complete and citations pass validation. There are at most eight candidates per pass; this remains a bounded review, not exhaustive extraction. Semantic cancellation handling depends on the model and human review.

Mailbox discovery and unfinished threads alternate so a long conversation does not monopolize processing. A thread-level parsing/provider/size error is deferred, its position saved, and the mailbox advances. Deferred threads are retried on a later scan cycle. A pass with deferred threads is labeled follow-up, not full completion; its previous completed watermark is retained. Unchanged legacy cached threads remain skipped rather than being rescanned solely for this upgrade. Model calls successfully checkpointed are not repeated on a normal retry. A process crash between provider response and database checkpoint can still cause a repeated charge; exactly-once provider billing cannot be guaranteed.

The UI shows last attempt, last full completion, conversations checked, the current section, follow-up count and next eligible attempt. Server-only `sot_scan_runs` retains attempt outcomes from this release onward; historical attempts are not fabricated. Spending limits remain 10 per three hours, 20 per UTC day and the configured monthly allowance. No automatic budget increase is made. Full-cycle completion still depends on available allowance and all deferred work resolving.


### Current-email processing (October 10 follow-up)
Automatic analysis selects unreviewed message IDs in the current seven-day window, bounded by the scan watermark. Completed message IDs are retained server-side; new replies do not require reanalysis of already completed messages. This is current-work coverage, not an exhaustive historical discovery scan. Existing completed thread cache remains compatible. In-progress section checkpoints from the old strategy restart under fresh-v1 because their boundaries differ; official suggestions and tasks are retained.

Verified repeated lines in quoted reply history are removed only when present in an earlier message. New inline replies and unknown forwarded material are preserved. HTML block boundaries are retained. One older message excerpt (up to 2,000 characters) is context only, alongside current workspace facts. It cannot independently support a new suggestion. Ambiguous references require clarification.

Sections now hold up to approximately 8 KB of email content within the unchanged 16 KB total input limit. More than four sections of new content causes a thread to be deferred before any AI call; it cannot monopolize the automatic allowance. Deferred threads need focused review, and a scan with deferred threads is not reported as fully complete. Budget limits remain unchanged. No claim is made that arbitrary historical context can be reconstructed from a short excerpt.
