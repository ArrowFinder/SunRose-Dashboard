# SOT setup

[Documentation home](README.md) · [Behavior and budget contract](SOT_TRUTH_MODEL.md)

SOT connects each active staff user's Gmail with read-only OAuth. Dashboard sign-in and the connected Gmail account are distinct. Do not share passwords or paste keys into chat or source control.

## Google and Supabase

1. Use the authorized Google Cloud project, enable Gmail API, and configure OAuth consent for the intended Workspace users. If the app is in testing, include the intended test users.
2. Configure a web OAuth client with the redirect URI `https://vpyddcdncjmkjlidbsdi.supabase.co/functions/v1/sot/callback`. Store the client ID as its identifier, without `https://` or trailing slash.
3. Store server secrets in Supabase: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`, `SOT_TOKEN_KEY` (32 bytes encoded as base64), `SOT_APP_URL`, and `SOT_SCHEDULER_KEY`. Supabase supplies its URL and service-role key. No secret belongs in frontend `VITE_` variables. Rotating the token-encryption key requires mailbox reconnection.
4. Follow [deployment](../DEPLOY.md): back up, apply pending migrations in order, deploy all SOT function files, then publish the frontend. The callback's gateway JWT check is disabled in `supabase/config.toml`; app routes still validate authentication and staff membership themselves.
5. Configure `supabase/deployment/schedule_sot.sql` using the same scheduler secret in Vault and Edge Function secrets. It dispatches due work each minute; the function enforces the six Pacific slots and shared budget. Verify the scheduled job and recent outcomes after deployment.
6. The user signs into SunRose, opens SOT, selects **Connect Gmail**, and authorizes the intended Google mailbox. This can initiate a manual scan. Never connect or scan merely to test a release without intended mailbox access and spending authorization.

## What to verify

Confirm the mailbox shown, automatic checks setting, next eligible check, queue counts and budget. An empty suggestion list does not prove there is no backlog. Test with a bounded, authorized real scan after local checks, and distinguish observed results from expected model behavior.

Google Docs and attachments are not integrated. Review [Google Docs follow-up](GOOGLE_DOCS_FOLLOWUP.md) before expanding access. Employees use the same OAuth app; each grants their own mailbox consent. Workspace policy may require administrator approval.
