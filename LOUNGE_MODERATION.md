# Lounge AI moderation

Scope: new Community Lounge text and later text edits only. No backfill, Staff Chat,
DMs, forum content, images, member reports, notifications, or automatic enforcement.
There is currently no Lounge editing UI; the database hooks cover future body edits.

## Deploy and enable

1. Verify a custom-format database backup and apply migration 033 before releasing
   the server. The migration leaves every existing message at revision zero.
2. Release server/client and verify `/privacy` and `/admin/lounge-review`.
3. On the existing Render Express service set `OPENAI_API_KEY` to the secret and
   `LOUNGE_MODERATION_MODE=testing`. Never add the key to Vercel or a VITE variable.
4. The queue's processing banner confirms mode/key presence, not API validity.
   Verify one authorized test message completes, then inspect the saved result.
   HTTP 401/429 and network failures appear as failed jobs after five attempts.

The default is `off`. New messages still enqueue while paused; enabling processes
that post-deployment backlog (up to 90 days). It never scans pre-migration history.
Each Express instance runs a single in-process asynchronous loop, no extra service.
Claims use SKIP LOCKED, unique tokens, two-minute leases and conditional completion.
At-least-once API calls are possible after crashes; database results are idempotent.
Polling backs off to 15 seconds idle, and retries use exponential delays.

## Decisions and tuning

`utils/loungeModerationConfig.js` contains provisional conservative thresholds.
Override individual categories with `LOUNGE_MODERATION_THRESHOLDS` JSON, e.g.
`{"harassment":0.97}`. Invalid configuration disables processing, not posting.
The overall API `flagged` boolean is retained but does not determine our queue.
Scores are not calibrated probabilities of violating community rules. Evaluate
false positives/negatives on recovery conversations before relying on thresholds.
Each result stores the thresholds and exact response for its text revision.

Only roles 1/10/50 can review; only roles 1/10 can delete another member's Lounge
message. Members retain existing own-message deletion. Staff Chat is unchanged.
Review actions are transactional and version-checked. Deletion uses existing soft
deletion fields and emits the normal Lounge deletion event. No automatic DMs.
Nearby-message context is staff-only and scoped to Community Lounge.

## Retention and privacy

The processor strips saved text, full responses, thresholds and category evidence
after 90 days, hourly while the server runs, even with AI processing off. Minimal
job/result metadata and staff decisions remain. Pending expired checks are retired.
Queue queries also exclude expired data before cleanup runs. Original messages and
database backups have their own retention; backups are not rewritten by cleanup.
Only the text body is sent to `/v1/moderations`; personal data typed into it is
necessarily included. No account identity, email, surrounding conversation or
message ID is attached to the API request. Do not enable optional API data sharing.

Verified documentation October 30, 2026:
- https://developers.openai.com/api/docs/guides/your-data
- https://developers.openai.com/api/docs/guides/moderation

## Disable or roll back

Set `LOUNGE_MODERATION_MODE=off` on Render and redeploy/restart to stop new API
requests. Existing queued jobs remain. If removing the feature entirely, revert
the client/server feature commits, then (after backing up any review history)
remove the two Lounge triggers/functions, three moderation tables and the two new
Lounge columns. Leave forum reports alone. Additive database objects may also be
left in place safely. A code rollback stops scheduled cleanup too, so explicitly
purge moderation snapshots/responses if permanently retiring the feature.
Text already sent to the provider cannot be unsent. Soft-deleted messages are not
restored by disabling or rolling back this feature.

## Verification

`npm run test:lounge-moderation` runs migration, worker and API scenarios in an
isolated transactional schema and rolls back. OpenAI responses are mocked: no key
or real member text is sent. Includes disabled mode, retries, lease recovery,
late-result rejection, posting despite enqueue failure, repair, role restrictions,
context isolation, deletion, audit history and retention.
