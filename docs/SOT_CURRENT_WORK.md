# Historical rollout: current-work scan, October 9, 2026

Current behavior is maintained in [SOT_TRUTH_MODEL.md](SOT_TRUTH_MODEL.md). The deployment pause described below was a rollout step, not a recurring requirement.


SOT now starts with a seven-day window of received and sent mail. Existing clients, accepted tasks, dismissed suggestions, review memory and the scan cache are preserved. The migration archives prior unreviewed suggestions without recording a rejection, clears the historical reassessment queue and pauses scheduling until deployment is complete.

Participant matching checks From, To and CC. Exact contacts take precedence over domains for each address; public email domains are excluded. Confirmed names and aliases in conversation text also count as relationship context. Any known-client context suppresses the client-discovery pass. A unique client anchors tasks to that client. Multiple candidates require user clarification. Unknown relationships still need quoted positive evidence before a new client suggestion can appear.

Known-client conversations use one task-analysis call. Unmatched conversations use separate client/task passes. Reservations enforce a workspace-wide maximum of 10 calls in a rolling three-hour window and 20 per UTC day, within the existing monthly allowance. October remains at 600; other months default to 300. Failed reserved requests also count. Website lookup has its separate existing allowance.

The server dispatcher checks due connections each minute. Batches continue within spending limits; after a completed scan the mailbox is eligible again after three hours. A spending-limit pause retries after three hours. Completed scan boundaries overlap by a day, with fingerprints preventing unchanged conversations from consuming another AI call. Older messages within a selected conversation may provide context; proposals must cite a message inside the current scan window. Attachments and Google Docs are not read.

Deploy the migration, then the SOT function, then the frontend. Only then re-enable automatic checks. Manual scans use the same spending reservation. The migration intentionally leaves existing mailboxes paused during deployment.
