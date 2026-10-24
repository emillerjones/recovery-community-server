# Editable Resources

The public `/resources` page reads `GET /api/resources`. Owners use
`/admin/resources-editor` to edit page introductions and parent categories,
and add, edit, delete, or reorder the resource links inside each category.
Categories appear in either Learn or Find Support. Saves publish the complete
draft using the last loaded revision; a concurrent publication returns 409
without replacing the editor's draft. IDs are stable when titles change.

The server reloads the authenticated account and permits writes only for an
active, approved Owner (role 1). Anonymous visitors can read public content.
Link addresses must be HTTP(S) without embedded credentials. Text renders as
React text, not HTML. Category/link counts and field lengths are bounded.

The initial migration is `db/migrations/029_add_resources_content.sql`.
It creates only `resource_pages` and seeds all five existing categories and
30 resource links. Rerunning it never overwrites an existing publication.
The same seed is included in `db/schema.sql` for new installations.

Before the configured database migration on 2026-10-24, a custom-format dump
was saved to `db-backups/resources-2026-10-24T17-04-31-684Z/database.dump`
(relative to the parent workspace). Its pg_restore catalog was verified.
The database seed was checked for five categories, 30 links, and revision 1.
Backup files contain private data and are not committed.

Validation:

- `npm run test:resources`: HTTP permissions, suspended account, validation,
  CRUD/order persistence, stale and concurrent saves, empty content, and
  idempotent seeding. Fixtures use a separate transaction-local schema;
  all test changes are rolled back, including the schema itself.
- Client focused ESLint, production build, and browser checks at 320px,
  390px, and 1440px for editing, publishing, conflict recovery, navigation,
  stable anchors, dynamic category counts, and the preserved static page.

Release order: migration, backend deployment, then frontend deployment.
The temporary `/resources-old` route preserves the static page and is linked
as Resources - Old. It works independently of this API. To roll back the
feature, revert the client and server commits; leave the additive table and
its saved content in place. No destructive database rollback is necessary.
