# Owner-created imported posts

Only Owners can create posts with `is_imported: true` and a free-form
`imported_author_label` (trimmed, 1–80 characters, no control/format characters).
The authenticated creator remains `author_id`; incoming author IDs are ignored.
Owners can also use another display name for new comments and nested replies.
Comments use the same `is_imported` and `imported_author_label` fields while
retaining their real creator in `author_id`. Existing edit routes cannot
change the imported status or display name.

The forum feed, thread, moderation queue, new-post/mention alerts and community
activity show the imported name. Post avatars use initials instead of the
Owner's avatar. Public displays show the name without an imported-post label. The Owner
continues to receive replies and manage their posts through their real ID.

## Release

1. Back up the configured database using custom-format pg_dump, validate its
   catalog with pg_restore --list, and snapshot posts before applying changes.
2. Apply `db/migrations/027_add_imported_post_authors.sql`. It is additive and
   idempotent. Verify every previous row is identical apart from the two new
   fields (`false`, `null`). It does not modify any reply table.
3. Deploy the server; verify the public unauthenticated forum endpoint returns
   401 with `X-Imported-Post-Authors: 1`. No privileged session is required.
4. Deploy the client, after focused lint, build and desktop/mobile UI checks.

## Reversal

Revert the client commit first to hide new creation controls. Leave the two
database fields in place: they are backward compatible and contain attribution
that should not be discarded. Keep the compatible server to preserve imported
name display. A full server rollback would make old code display the real
creator for imported posts, so coordinate that rollback or fix forward rather
than silently changing attribution. The validated full backup is for disaster
recovery, not routine rollback: restoring it can discard subsequent activity.

## Verification

`npm run test:imported-posts` uses a temporary schema and rolls back all changes.

## Comment and reply extension (migration 028)

Back up the database and verify its catalog before applying
`db/migrations/028_add_imported_comment_authors.sql`. This adds two optional
identity fields with ordinary-comment defaults and a consistency constraint.
Apply the migration before deploying the backend, then deploy the client.
No existing comment bodies, authors, or reply relationships are rewritten.

The Owner-only identity selector appears in both the bottom comment composer
and nested reply forms. Switching identity preserves the current draft;
successful submission resets only that composer's identity to Myself.
Notifications, moderation, Socket.IO comment payloads and Lounge activity use
the chosen public name and an initials avatar without an imported badge.
Recipients and all existing permissions remain unchanged.

Rollback: revert the client feature commit first. Leave the additive columns
and backend name rendering in place so any published named replies retain
their attribution. Do not drop the columns or restore an old database merely
to undo the appearance. The integration suite exercises named direct/nested
replies, rejected non-Owner requests, validation, immutable attribution on
edit, normal comments, alert names, moderation, activity and migration checks.
It tests the populated-schema migration, Owner/Admin/Moderator/Member boundaries,
bad names and forged creator IDs, all post author surfaces, normal posts, editing
and unchanged reply behavior. Existing post-history and staff-announcements
tests protect adjacent permissions and privacy.
