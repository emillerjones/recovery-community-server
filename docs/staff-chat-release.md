# Staff Chat prototype

Staff Chat is one private, persistent Lounge room. Only approved, active human
users with role IDs 1 (owner), 10 (administrator), or 50 (moderator) can use it.
New staff can read its existing history. Every staff member can remove a message,
as in the Community Lounge; removal keeps a placeholder instead of deleting the row.

There are no email, push, sound, unread badge, or notification records for this
feature. The client subscribes to live messages only while the chat is open and
refreshes while open to recover from missed connections. No staff content uses
the public Lounge broadcast or its unread tracking.

## Database and deployment

1. Take a custom-format `pg_dump` backup and validate its catalog with
   `pg_restore --list`. Store the backup outside either Git repository.
2. Run the isolated test with `npm.cmd run test:staff-chat` from the server repo.
   It uses a temporary schema in a transaction and rolls it back. It requires
   the sibling client's installed Socket.IO client dependency.
3. Apply `db/migrations/023_add_staff_chat.sql` using `psql` with
   `ON_ERROR_STOP=1`, or a PostgreSQL client that executes the file's transaction.
   This adds `lounge_rooms.access_level` and the `staff-chat` row. Existing
   messages and read markers are not changed. The migration can be rerun.
4. Deploy the server, then the client. The client has a Staff Chat entry in its
   account/mobile menu and a launcher above the Lounge on member pages. On
   message pages and narrow forum threads, use the menu to avoid covering controls.

## Disable or undo without losing conversations

For an immediate server-side stop, run:

```sql
UPDATE lounge_rooms SET active = FALSE WHERE slug = 'staff-chat';
```

All subsequent reads, writes, joins, and live delivery are blocked. Existing
messages already rendered in a browser cannot be recalled. The client will show
the unavailable state on its next refresh. Re-enable with `active = TRUE` when
appropriate.

To remove the feature entirely, revert its client commit and its server feature
commit with `git revert`, then push both reverts. Retain the separate server
commit that scopes Lounge queries/deletions to a room. This preserves protection
for saved staff records even after the feature is removed.
That safety commit is `608877b`.

Leave the added column and room/messages in the database. They are harmless to
the previous application and preserve the team's history. Do not drop tables,
run `db:reset`, or restore the whole backup for a routine feature rollback: doing
so could lose unrelated community activity created since the backup.

## Verification

The integration test covers guest/member rejection, all three staff roles,
saved history, pagination, private Socket.IO delivery, cross-room deletion,
role demotion with an existing token/socket, account suspension, session
revocation, room deactivation, and the existing public Lounge. Browser checks
cover mobile and desktop bounds, menu visibility, history scrolling, failed
send draft retention, successful sending, and closing/restoring the page.
Real iPhone/Android keyboard behavior still needs an on-device check.
