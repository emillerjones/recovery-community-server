import db from "#db/client";

export async function getHomeTestPage() {
  const { rows: [page] } = await db.query(
    "SELECT content, revision, updated_at FROM home_test_pages WHERE page_key = 'home-test'"
  );
  return page;
}

export async function updateHomeTestPage({ content, revision, updatedBy }) {
  // Compare-and-save prevents one editor from overwriting a newer publication.
  const { rows: [page] } = await db.query(
    `UPDATE home_test_pages
     SET content = $1::jsonb, revision = revision + 1, updated_by = $2, updated_at = NOW()
     WHERE page_key = 'home-test' AND revision = $3
     RETURNING content, revision, updated_at`,
    [JSON.stringify(content), updatedBy, revision]
  );
  return page;
}
