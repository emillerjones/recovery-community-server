# Staff Announcements

The forum has a third section for approved, active owners, administrators, and
moderators. Staff Chat stays separate and unchanged. Staff can publish and reply;
authors edit their own posts/replies and only the owner can edit anyone else's.
Owners/admins may pin or lock staff posts. Existing deletion rules are retained.

The client marks the section, cards, thread, and composer as staff-only using
purple accents plus explicit text/icons. The composer posts an explicit audience
and keeps separate drafts for community, community announcements, and staff.
There is no control for moving a staff post into a community category.

On a staff announcement, the existing `agree` reaction is labeled "Got it".
The thread lists current staff who selected it. It is a replaceable/removable
reaction, not a formal read receipt or confirmation of a particular revision.
Reactions are not reset when a post is edited; the interface says so.

## Privacy boundaries

- The shared API gate protects every post subresource and checks that reply IDs
  actually belong to the supplied post. Server-side roles remain authoritative.
- Normal feeds, search/filter scopes, category listings/counts, tag counts, and
  Community Pulse exclude staff content for ordinary members. Staff feed content
  is also kept out of the normal community feed and community aggregates.
- Protected image requests check post access and use no-store caching.
- Thread joins and each live delivery recheck current access, including old
  sockets belonging to someone who has since lost their staff role.
- Staff content creates no notifications, including mentions, replies, reactions,
  or the existing database new-post alerts. A database trigger enforces this for
  every notification writer. Following can still save a post for later.
- New staff can see existing staff history. Role removal stops future access;
  content already read or downloaded cannot be recalled.

## Deployment

Back up with `pg_dump --format=custom` and validate with `pg_restore --list`.
Keep backups outside Git. Apply `db/migrations/024_add_staff_announcements.sql`
with errors stopping execution. Its transaction adds `forum_categories.access_level`,
one staff category, and an alert-suppression trigger. It does not change existing
post bodies or ownership and is safe to rerun.

Deploy the server before the client. The reserved staff category slug is also
checked independently of the new column, allowing the server privacy code to
run before migration. Do not publish staff posts until the server is deployed.

## Disable / rollback

Disable the section server-side without deleting history:

```sql
UPDATE forum_categories SET active = FALSE WHERE slug = 'staff-announcements';
```

Revert the client feature commit if the interface needs to be withdrawn.
Keep the server privacy checks, added column, and notification guard in place
while any staff posts exist. Reverting to the old server would reopen read paths
that never distinguished private staff content. Do not restore the full backup
or delete staff records for a routine interface rollback.

## Validation

`npm.cmd run test:staff-announcements` uses a random schema and rolls back all
fixtures. It covers all roles, direct links/subresources, mismatched reply IDs,
author/owner edit rules, pins, acknowledgments, attachments, normal feeds and
Community Pulse, notification suppression, real Socket.IO delivery and demotion.

Regression checks: `test:post-history`, `test:staff-chat`, `test:forum-photos`,
and `test:polls`. Client validation includes changed-file ESLint, a production
build, and browser checks at 320px, 390px, and desktop widths for audience cues,
ordinary-member exclusion, separate restored drafts, network failure recovery,
publishing, acknowledgments, and horizontal overflow.
Actual iPhone/Android keyboard behavior still needs a device check.
