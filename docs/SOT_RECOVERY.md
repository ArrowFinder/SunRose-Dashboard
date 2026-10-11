# SOT recovery and review

[Documentation home](README.md) · [Current behavior and budgets](SOT_TRUTH_MODEL.md)

## A conversation needs review

1. Sign in as the person whose mailbox is connected and open SOT.
2. Expand **Conversations needing review**, then open the source in Gmail.
3. Use **Retry or resolve**. Select a small group of messages and choose **Queue retry**. The remaining messages are kept for later review. Retrying is subject to the normal budget; an interrupted previous request may already have been billed.
4. If the content is too large, or you already handled it, create/update the relevant dashboard work manually. Enter a short explanation and choose **Mark handled manually**. This does not count as AI analysis or modify Gmail.
5. An old entry without saved content offers retrieval from Gmail before analysis. Use **Check email now** or await the next automatic check. Automatic checking must be enabled for unattended processing.

Email retrieval failures are shown separately and retried without destroying the saved queue. A conversation is not considered reviewed just because its email was collected. An active scan must finish before changing its recovery state. A recovery action does not itself spend an AI call.

## An employee needs a project approved

The owner/admin opens **Overview → Owner review inbox → Team project suggestions**, checks the evidence and scope, and chooses **Review and approve project**. Approval links that employee's pending task suggestions to the project; the employee still decides whether to add each task. No owner impersonation or automatic task acceptance occurs.

## A client submits a request

The request appears under **Overview → Owner review inbox → Client requests**. Choose a specific project, creating one first if necessary, and add the task. It starts private and assigned to the reviewer. Adjust its assignee and client visibility on the task page. Dismiss requests that should not become work.

## Correct historical time after moving a task

Edit the existing entry. Keeping its original project/task association allows note, time and billability corrections even when the task has moved. Changing the association must satisfy the current project rules. Submitted, approved and locked pay periods continue to block edits until an authorized manager returns the period for correction.
