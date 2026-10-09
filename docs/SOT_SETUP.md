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

## Deployment (developer)

The frontend is GitHub Pages; secrets and external API requests run only in a Supabase Edge Function. Do not use VITE-prefixed variables for any secrets.

Apply the new migrations in order, with a commit between them:
1. `20261002000000_supervisor_role.sql`
2. `20261002010000_sot.sql`
3. `20261003000000_sot_client_identity.sql`

Do not replay old migrations after new ones; earlier function definitions would overwrite role checks. The SOT migration is additive and does not remove existing business records.

Set these server-side Supabase Edge Function secrets:
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: from Sierra's Google project.
- `OPENAI_API_KEY`: the separately provisioned key currently in ignored local `.env.local`. Transfer securely, never through frontend configuration or logs.
- `SOT_TOKEN_KEY`: random 32-byte key encoded as base64, generated once and retained securely. It encrypts refresh tokens with AES-GCM. Replacing it requires mailbox reconnection.
- `SOT_APP_URL`: `https://arrowfinder.github.io/SunRose-Dashboard/`

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Do not expose the service role key. OAuth tables have RLS enabled and no user grants; only the Edge Function can access credentials/state/cache/usage. State values are random, hashed, expire after ten minutes and are consumed once. JWT verification is disabled at the gateway only because Google's callback has no JWT; every non-callback request calls auth.getUser and checks an active internal role.

Deploy with Supabase CLI (`supabase functions deploy sot --project-ref vpyddcdncjmkjlidbsdi`) using the checked-in config. Deploy the frontend only after the migration and function are ready. A not-configured status disables Connect Gmail and leaves the existing dashboard usable.

## Budget and retention

Model: gpt-4.1-mini, Responses API with strict structured outputs and `store:false`. No model tools. Email content is treated as untrusted text. Only proposals may be produced, and backend validation restricts their references and fields. OpenAI still processes relevant email text; users are told this before connecting.

A hard database limit permits 300 analysis calls per UTC month across the workspace. Each request limits serialized context/email input to 16,000 UTF-8 bytes and output to 2,400 tokens. The instruction/schema overhead also consumes tokens. This bounds usage, but is not a dollar-denominated billing limit; set a project budget alert in OpenAI and verify actual usage before increasing it. Failed provider calls conservatively count against the allowance. Cached unchanged threads do not call AI.

Raw email bodies and access tokens are not stored in the application database. Suggestions retain a short description, evidence excerpt, subject and Gmail thread reference privately for the mailbox owner. Disconnect revokes the Google grant, deletes local credentials/cache and pending suggestions, and preserves accepted tasks. Google revocation can affect other grants for the same Google OAuth application/account.

## Validation and launch checks

- `npm test`: existing task/time tests plus SOT role/privacy/acceptance/deduplication/update/scan-cap tests.
- `npm run build`: frontend type/build validation.
- `deno check --node-modules-dir=none supabase/functions/sot/index.ts`: server validation.
- `node --import tsx tests/sot-live-smoke.ts`: optional paid API smoke check using fabricated email and the local key. Never runs in normal tests.

Before live launch: connect Sierra's mailbox with her consent; confirm the connected address; complete a small initial batch; compare suggestions against source emails; approve one client and one task; verify Owner/Supervisor notifications; test disconnect/reconnect. OAuth and actual Gmail access cannot be end-to-end tested until her Google setup is complete. No live mailbox scan or background scheduler is claimed by the automated tests.

## Client checklist and websites

Every client suggestion shows business name, real email contact, source evidence of an agency-client relationship, the existing-client check, and identity resolution. Add is blocked until required checks are complete. A missing relationship quotation can be explicitly confirmed by the reviewer; this confirmation is recorded in the suggestion. Contacts can belong to multiple businesses. Ambiguous suggestions require selecting an existing client or confirming a separate business; the system never picks a business solely because its contact email matches. Confirmed aliases, contacts and websites are included in later analysis context and can be viewed on the internal client workspace.

Website lookup is optional and on demand through **Find website**. The editable public query defaults to business name, city and business type. Only the submitted query is sent to web search, never the underlying email text. One hosted web search is allowed per request, with a separate hard ceiling of 40 lookups per UTC month for the whole workspace. The result must match an actually consulted source (www/non-www equivalents allowed) and still requires **Use this website** before acceptance saves it. Search results are evidence for review, not guaranteed identity verification. No result does not block adding a client. Existing approved websites are not automatically overwritten.

The live website smoke check uses only the public query “OpenAI San Francisco artificial intelligence”; it does not involve Sierra's mailbox. Run `node --import tsx tests/sot-website-live-smoke.ts` only when intentionally testing the paid API.

## Discovery v2 deployment

Apply `20261004000000_sot_review_memory.sql` and then `20261004010000_client_share_token_default.sql` after the earlier SOT migrations. Then run `supabase/deployment/confirmed_clients.sql` for this workspace only: it creates the six owner-confirmed clients without importing inferred contact associations. Only the explicitly confirmed `latimes.com` domain is seeded. Review other domain associations before adding them.

Deploy the updated Edge Function and frontend together. Client discovery and task extraction now use independent structured calls; each processed thread reserves two calls within the unchanged 300-call workspace monthly limit. This permits at most 150 fully analyzed threads/month before cached threads and retries are considered. Existing usage is not reset. Initial discovery may span billing months at this cap; use the visible usage interruption to decide whether to authorize a higher allowance. No automatic budget increase is included.

Routine scans query messages since the prior completed scan, with a one-day overlap, and freeze the upper boundary while paging. Only changed message content enters AI analysis; client profile edits no longer invalidate every cached thread. A model-version change can require reconsideration within the fetched window. Reassess pending suggestions queues only conversations underlying the user's current pending suggestions, retaining accepted/dismissed decisions and normal scan progress. Missing/archived conversations without qualifying content are skipped, not invented as completed work. Very long conversations retain the existing bounded recent-message context; attachments remain excluded.

Review history is private to the reviewer. Acceptance and optional rejection reasons inform relevant future analysis. An unqualified dismissal is not a business-wide exclusion. This is retrieval of saved feedback, not model fine-tuning or a guarantee against future errors.

For background checks, create a random 32-byte `SOT_SCHEDULER_KEY` in Edge Function secrets and store the same value in Supabase Vault as `sot_scheduler_key`. Run `supabase/deployment/schedule_sot.sql` after configuring both. The cron dispatcher ticks each minute but processes at most one due mailbox/thread. Unfinished discovery/reassessment continues in bounded batches; completed mailboxes next become due after three hours. Provider errors back off three hours; budget exhaustion backs off until the next UTC month. Staff can pause their automatic checks. No keys belong in SQL files or GitHub. Verify the cron job, successful invocations, and next-scan timestamps before describing automatic checks as live.

Google Docs remains deferred until the email review changes have been validated against real suggestions.

An explicit one-month allowance increase can be applied by the service administrator through `sot_usage.analysis_limit`. It defaults to 300, app users cannot change it, and the next month's new row defaults to 300 again. No increase is applied by this migration or the confirmed-client setup script.
