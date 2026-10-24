# Editable Guidelines

Public page: `/guidelines`. Owner editor: `/admin/guidelines-editor`, linked
as Edit Guidelines alongside the existing admin editors. The editor is a flat
list with independent Save/Discard per guideline and a separate page-text form.
Saving publishes immediately; confirmed deletion and reordering save immediately.
There is no parent category or master Save All. At least one rule must remain.

`GET /api/guidelines` serves public content without caching. Owners write one
action at a time through `PATCH /api/guidelines/items`: save-page, save-item,
delete-item, or reorder-items. Active approved Owner status is checked on the
server. The request includes its loaded revision; stale or concurrent writes
return 409 without replacing local unfinished edits. Each action applies only
to saved content, so saving one rule never publishes another rule's draft.

Stable item IDs preserve anchors across title/order changes. Visible numbers
and the public index follow the saved order. The eight initial titles, bodies,
and icons match the original page. Page text includes the introduction, sidebar,
charter heading, contact invitation, and disclaimer. The Contact destination
stays fixed. Plain text renders through React without HTML interpretation.

Migration `031_add_guidelines_content.sql` creates only `guidelines_pages` and
seeds the current eight rules. Reruns preserve published content. The same
idempotent seed is in `db/schema.sql` for fresh installs. Before migration, a
custom-format database dump was saved at the parent workspace's
`db-backups/guidelines-2026-10-24T18-02-10-798Z/database.dump`; its pg_restore
catalog was verified. Backup contents are private and not committed.

Validation: `npm run test:guidelines` uses a private schema inside a transaction
that always rolls back. It verifies exact seed content, public reading, Owner
and account restrictions, field/icon validation, independent saves, CRUD/order,
last-rule protection, conflicts/concurrent writes, and migration idempotence.
Browser checks at 320px, 390px, and 1440px verify original rule text, independent
saves with invalid sibling drafts, discard and success/error states, automatic
ordering/rollback, deletion, stable anchors, numbering, safe text, navigation,
and widths. Focused lint and build pass.

Release order: backed-up migration, backend deployment, frontend deployment.
Rollback: revert the client and server feature commits, leaving the additive
table and saved content in place. The original static page is retained in Git.
