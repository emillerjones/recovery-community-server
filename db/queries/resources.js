import db from "#db/client";

export async function getResourcesPage() {
  const { rows: [page] } = await db.query(
    "SELECT content, revision, updated_at FROM resource_pages WHERE page_key = 'resources'"
  );
  return page;
}

export async function updateResourcesPage({ content, revision, updatedBy }) {
  // Compare-and-save prevents one editor from overwriting a newer publication.
  const { rows: [page] } = await db.query(
    `UPDATE resource_pages
     SET content = $1::jsonb, revision = revision + 1, updated_by = $2, updated_at = NOW()
     WHERE page_key = 'resources' AND revision = $3
     RETURNING content, revision, updated_at`,
    [JSON.stringify(content), updatedBy, revision]
  );
  return page;
}
