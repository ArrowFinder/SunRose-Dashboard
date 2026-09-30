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
