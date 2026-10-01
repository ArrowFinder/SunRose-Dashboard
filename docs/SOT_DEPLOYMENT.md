# SOT deployment — 2026-10-01

Applied production migrations in order to project vpyddcdncjmkjlidbsdi:
- 20261002000000_supervisor_role.sql
- 20261002010000_sot.sql
- 20261003000000_sot_client_identity.sql

Verified all 11 SOT tables have row-level security enabled. Deployed sot Edge Function from the tested index.ts, core.ts and identity.ts sources; verified editor contents match repository files before deployment. Google credentials, OPENAI_API_KEY, SOT_TOKEN_KEY and SOT_APP_URL are saved as server-side secrets. No secret values belong in this document.

The user explicitly approved disabling the legacy gateway JWT check so Google's OAuth callback can reach SOT. Application requests still validate auth.getUser and active staff membership; callbacks validate hashed, single-use, expiring state.

48 tests and the frontend production build passed before deployment. A real Gmail connection and source-to-suggestion review remain the user's launch verification step. No real mailbox has been read as part of deployment.

Google Docs scope and questions are deferred in GOOGLE_DOCS_FOLLOWUP.md.
