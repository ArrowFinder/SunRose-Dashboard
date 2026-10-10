# SOT — Source of Truth

## What is implemented

Personal Gmail OAuth connection for active Owner, Admin, Supervisor and Employee accounts. Clients cannot connect. Gmail access is read-only. Each person reviews their own client/task/subtask/update/completion suggestions on Overview or SOT. Add accepts populated fields; Delete dismisses without changing email. New clients start with zero retainer hours until configured. New tasks are private and assigned to the approving mailbox owner. Owner and Supervisor receive an in-app notification; Admin does not.

Supervisor has internal task and timer access across the workspace, without account management, time correction or client-sharing permissions.

Initial scan starts after connecting; scans include Inbox and Sent for the preceding 90 days. For sunrosecreative.com accounts, relevant client work is extracted from mailbox conversations. Other mailboxes are restricted to messages with an exact sunrosecreative.com sender/recipient/CC. Attachments, spam, trash and drafts are excluded. Archived received threads without an inbox/sent match are outside the initial scope.

Scans run in batches while the SOT page is open, with Pause/Continue support. Choose Scan emails for subsequent scans. **Unattended background scanning is not part of this version.** Each changed thread replaces only its pending suggestions; accepted/dismissed decisions remain. Exact request keys deduplicate across mailboxes, and acceptance also checks existing client/title/parent/deadline matches. Semantic duplicate detection is assisted by the model and requires user review.

No actual Sierra mail has been accessed during development. Local tests use fabricated records; the live OpenAI smoke check also uses a fabricated email.

## Sierra: Google setup

1. Sign in to Google Cloud Console with an account authorized to manage the Sunrose Creative Workspace organization. Create/select a project owned by that organization, named SunRose SOT.
2. Enable the Gmail API.
3. In Google Auth Platform, configure Branding and Audience. Use Internal when all connecting staff accounts belong to the same Google Workspace organization. Personal Gmail or other organizations require an External app and may require Google's restricted-scope verification; do not assume Internal supports those accounts.
4. In Data Access, request only `https://www.googleapis.com/auth/gmail.readonly`.
5. Create an OAuth client, type Web application. Add this exact authorized redirect URI:

   `https://vpyddcdncjmkjlidbsdi.supabase.co/functions/v1/sot/callback`

6. Keep the OAuth client ID and client secret private. Save them directly into Supabase Edge Function secrets as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, or arrange a secure setup session. Do not paste the secret in chat, send by email, or commit it to GitHub.
7. Once deployment is confirmed, sign in to the SunRose dashboard with your existing SunRose account, open SOT, click Connect Gmail, and select `sierra@sunrosecreative.com`. Grant read access. Connecting Gmail does not replace the dashboard sign-in account.

Relevant Google documentation:
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/gmail/api/auth/scopes
- https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification

## Current implementation and deployment

See [SOT_TRUTH_MODEL.md](SOT_TRUTH_MODEL.md) for the current behavior, evidence rules, suggestion types, limits and validation plan. Earlier setup versions described a 90-day initial discovery and two calls for every thread; those are no longer the routine current-work behavior.

Apply unapplied migrations in filename order, committing enum additions before later migrations. Do not replay old migrations over newer function definitions. Deploy the server function before the frontend. The standalone project release ends with `20261010070000_sot_truth_projects.sql`.

Server-only secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OPENAI_API_KEY, SOT_TOKEN_KEY (32 bytes encoded as base64), SOT_APP_URL and SOT_SCHEDULER_KEY. Supabase supplies SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Never place secrets in VITE-prefixed configuration or logs. Replacing SOT_TOKEN_KEY requires mailbox reconnection.

The callback's legacy gateway JWT check remains disabled because Google cannot supply that header. Application requests verify the authenticated active staff user; OAuth callbacks verify a hashed, single-use, expiring state. Tokens are encrypted server-side. Raw email bodies and access tokens are not persisted; private suggestions retain summaries, short quotations and source references.

The existing scheduler configuration is in `supabase/deployment/schedule_sot.sql`. Keep its Vault secret aligned with the function secret. Verify actual invocations and next-scan timestamps before asserting that scheduling is live. No scheduler or quota change is needed for standalone project suggestions.

Website lookup stays an optional separate action with a 40-per-month workspace allowance. Only the submitted public search query is sent to web search. Results require explicit reviewer confirmation. No website is invented from a company name.

Google Docs remains deferred; see [GOOGLE_DOCS_FOLLOWUP.md](GOOGLE_DOCS_FOLLOWUP.md). API smoke scripts are optional paid tests and never part of `npm test`.
