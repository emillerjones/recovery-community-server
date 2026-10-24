# Editable Home - Test

Public preview: `/home-test`. Owner editor: `/admin/home-test-editor`.
The navbar links these as Home - Test and Edit Home - Test. The original `/`
route still renders the unchanged static Home component and stylesheet.

Forty text fields are grouped into six independently saved sections: hero,
purpose, principles, offerings, social text, and disclaimer. Button/link labels,
destinations, images, icons, card order, and layout remain in code. Shared nav
and footer content are outside this editor. Text is rendered by React without
HTML interpretation. Per-field length limits protect the layout.

`GET /api/home-test` returns content, revision, and the fixed field definitions.
`PATCH /api/home-test/sections/:sectionId` accepts that section's `fields` and
the loaded `revision`. Only active approved Owners can save. Unknown sections,
extra fields, invalid types, empty text, or overlong text are rejected. Saves
replace only the selected section of saved content; unrelated browser drafts
are never sent. Concurrent saves return 409 and preserve unfinished edits.
Success indicators are shown only after the server confirms the save.

Migration `030_add_home_test_content.sql` creates only `home_test_pages`, seeded
from the current Home text. It is idempotent and never replaces an existing
publication. `db/schema.sql` includes the same seed for fresh installations.
The database dump at the parent workspace's
`db-backups/home-test-2026-10-24T17-48-32-424Z/database.dump` was created and its
pg_restore catalog verified before migration. Backup data is not committed.

The preview is public, not private. Its route has an X-Robots-Tag noindex,
nofollow response header and a scoped robots meta tag. Removing the preview
meta tag on unmount keeps normal Home indexing unchanged. The API also sends
noindex, nofollow and no-store.

Validation: `npm run test:home-test` uses a private schema inside a transaction
and rolls everything back. It checks all 40 fields, permissions/account status,
unknown or extra fields, section isolation, stale/concurrent saves, and seed
idempotence. Browser checks at 320px, 390px, and 1440px compare the initial page
against Home, verify every editable field is wired, preserve actions/images,
check save/discard/error feedback, navigation and Owner guards, and verify
literal text rendering and long-text overflow. Focused lint and build pass.

Release order: backed-up migration, backend deployment, frontend deployment.
Rollback: revert the client and server feature commits, leaving the additive
table and its saved content in place. Promoting Home - Test to the main Home
route is a separate, explicitly authorized change.
