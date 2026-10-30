# Lounge AI moderation

Scope: new Community Lounge text and later text edits only. No backfill, Staff Chat,
DMs, forum content, images, member reports, notifications, or automatic enforcement.
There is currently no Lounge editing UI; the database hooks cover future body edits.

## Deploy and enable

1. Verify a custom-format database backup and apply migrations 033, 034 and 035 before
   releasing the server. Migration 033 leaves existing messages at revision zero.
   Migration 034 adds a paused-by-default Owner setting and its change history.
   Migration 035 adds saved category cutoffs and a separate cutoff change history;
   it preserves the existing processing toggle and effective default cutoffs.
2. Release server/client and verify `/privacy` and `/admin/lounge-review`.
3. On the existing Render Express service set `OPENAI_API_KEY` to the secret and
   `LOUNGE_MODERATION_MODE=testing`. Never add the key to Vercel or a VITE variable.
4. An Owner checks **Enable AI checks** on `/admin/lounge-review` and confirms.
   The setting is shared by all server instances and takes effect on the next
   cycle (normally within 15 seconds). Pausing does not cancel an in-flight request.
   Every real change records the Owner, old/new value, revision and timestamp.
   Stale forms return 409 rather than overwriting another Owner's change.
5. The queue's processing banner confirms mode/key presence, not API validity.
   Verify one authorized test message completes, then inspect the saved result.
   HTTP 401/429 and network failures appear as failed jobs after five attempts.

Render `off` is an unconditional override. `testing` allows the database Owner
setting to control processing; neither is sufficient without a key and valid
threshold configuration. If settings cannot be read, no new checks start.
The database preference defaults to paused; deployment does not activate AI.
New messages still enqueue while paused; enabling processes
that post-deployment backlog (up to 90 days). It never scans pre-migration history.
Each Express instance runs a single in-process asynchronous loop, no extra service.
Claims use SKIP LOCKED, unique tokens, two-minute leases and conditional completion.
At-least-once API calls are possible after crashes; database results are idempotent.
Polling backs off to 15 seconds idle, and retries use exponential delays.

## Decisions and tuning

Staff can open **AI review thresholds** on the review page to see all 13 categories,
plain-language explanations, examples and effective cutoffs. Only Owners can edit
and save a category, with independent Save/Cancel behavior and visible confirmation.
Database `moderation_settings.thresholds` stores overrides of the provisional
defaults in `utils/loungeModerationConfig.js`. Cutoff revisions and changes are
separate from the processing-toggle revision/history. Stale edits return 409.

Precedence: Render `LOUNGE_MODERATION_THRESHOLDS` overrides saved Owner cutoffs,
which override code defaults. A Render-controlled category is explicitly labeled
and cannot be edited through the app/API until its Render override is removed.
Invalid configuration disables processing, not posting.
Changes apply to checks starting afterward (including queued messages), not
in-flight checks or old results. Nothing automatically reprocesses historical text.
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
requests, or pause through the Owner checkbox without a restart. Existing queued
jobs remain. Reverting just migration 034's code can remove the Owner pause gate,
so set Render to `off` before rolling back that code. If removing the feature entirely, revert
the client/server feature commits, then (after backing up any review history)
remove the two Lounge triggers/functions, three moderation tables and the two new
Lounge columns, plus `moderation_settings` and `moderation_setting_changes`.
Also remove `moderation_threshold_changes` if retiring the threshold editor.
Leave forum reports alone. Additive database objects may also be
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
