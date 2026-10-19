# Agree to Like

Stored reactions and the new button use `like` / `Like`. Staff announcements
continue to display `Got it`. No other reaction is added, removed, or converted.

## Deployment order

1. Make a custom-format database backup and validate it with `pg_restore --list`.
   Capture every reaction row for an exact before/after comparison.
2. Apply `db/migrations/025_prepare_like_reaction.sql`. It permits Like alongside
   Agree without changing rows or removing historical allowed types.
3. Deploy the server. Both input spellings now save `like`. Verify an unauthenticated
   `/api/forum/categories` GET returns 401 and `X-Reaction-Storage: like`.
4. Apply `db/migrations/026_rename_agree_to_like.sql`. It changes existing Agree
   rows to Like, preserving IDs, users, targets, timestamps, and other types.
   The database no longer accepts new Agree rows.
5. Verify rows against the snapshot, then deploy the client.

Old pages omit `reaction_format` and receive the old spelling in thread responses
so their selected reaction and remove/change behavior keep working. This is API
compatibility only: their Agree submissions save Like. New pages request the Like
format. Staff acknowledgment queries accept either spelling during deployment.

The deployed database still has historical `encouragement` records. These
migrations preserve the existing constraint's other allowed values and leave
those records untouched. The UI and API offer the same seven choices as before.

## Rollback

Keep the compatible server running while reverting the client. Before restoring
the previous server, run `db/rollbacks/026_restore_agree_reaction.sql` and compare
the rows against the snapshot. The rollback restores Agree without changing
IDs or timestamps. Coordinate the server rollback to avoid new Like writes
after the constraint has returned to Agree. The full backup is the recovery
fallback; restoring the entire database can discard intervening activity.

## Checks

- `npm run test:like-migration`: isolated transaction; expand/rename/idempotency,
  exact row preservation including legacy encouragement, rollback and reapply.
- `npm run test:staff-announcements`: posts and replies, Like and legacy Agree
  inputs, selected reaction/counts in both formats, change/remove, staff names,
  and existing staff privacy boundaries.
- Client: focused ESLint and production build.
