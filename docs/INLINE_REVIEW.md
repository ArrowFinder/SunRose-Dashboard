# Inline review and teammate setup

[Documentation home](README.md)

## User workflow

Overview keeps pending suggestions but hides SOT notification history. The dedicated SOT page retains that history; no records are deleted.

Owner/admin users can choose **Add teammate** on Team, or **Add teammate** inside Edit before adding. Supply a name, email and staff role. The account is created immediately, can receive assignments, and returns a private, expiring setup link to share manually. No invitation email is sent. The recipient follows the link and chooses their own password. Never share a setup link with anyone other than its intended recipient.

If an unused link expires, repeat the same name, email and role to obtain a new one. Activated accounts cannot receive a new invitation through this action; manage access on Team and use password recovery instead. Existing unrelated accounts cannot be claimed through this flow. Client accounts are not created here.

Within Edit before adding, owners/admins can create a missing client or a specific project under the selected client. Each saved record is selected immediately and becomes available throughout the workspace. Matching names are reused to avoid duplicates. Archived clients, completed projects and General placeholders cannot be selected through creation.

Creation saves immediately: cancelling the suggestion does not remove the new client, project or teammate. Other draft fields are preserved while creating records. Finish by choosing Save and add, or delete the suggestion from this window. Task/subtask suggestions require a project, and subtasks can select an existing parent in that project. Assignment defaults to the suggestion reviewer and can be changed to another active staff member. Existing duplicate tasks retain their existing assignment.

Project suggestions can confirm or change their client before approval. Their original proposal identity is retained for replay protection; related task suggestions are linked only when they already belong to the approved client. Changing a project’s client never silently moves other tasks across clients.

## Permissions and implementation

Creation remains owner/admin-only; support view is read-only. Other staff can review their own suggestions under existing permissions. Team provisioning runs through the authenticated SOT function, separately from Gmail/AI analysis and budgets. The service-only database reservation verifies the actor’s current role, limits new reservations, and prevents claiming an existing email. Role assignment is finalized and audited before the private link is returned. Links are not stored in the application database or audit records.

The server uses Supabase [generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink), not inviteUserByEmail. Invite callbacks enter the password-setup screen outside the hash router. The deployment’s allowed Auth redirect URL must include the application URL.

Apply `20261014000000_inline_review.sql`, deploy the complete SOT function including `team.ts`, then publish the frontend. Follow the backup and verification procedure in [DEPLOY](../DEPLOY.md).

## Verification

Regression tests cover role boundaries, stale review rejection, duplicate creation, assignment, client/project consistency, idempotent replay, service-only provisioning, existing-account protection, and failures before link disclosure. Local preview uses a simulated Auth setup link and never sends email or creates real accounts. A successful local preview is not proof of a live Supabase invitation callback; verify one intended teammate’s setup after deployment with the recipient completing password entry.
