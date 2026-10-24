import db from "#db/client";

export async function getOurStoryPage() {
  const { rows: [page] } = await db.query(
    "SELECT content, revision, updated_at FROM our_story_pages WHERE page_key = 'ourstory'"
  );
  return page;
}

export async function updateOurStoryPage({ content, revision, updatedBy }) {
  // Compare-and-save prevents one editor from overwriting a newer publication.
  const { rows: [page] } = await db.query(
    `UPDATE our_story_pages
     SET content = $1::jsonb, revision = revision + 1, updated_by = $2, updated_at = NOW()
     WHERE page_key = 'ourstory' AND revision = $3
     RETURNING content, revision, updated_at`,
    [JSON.stringify(content), updatedBy, revision]
  );
  return page;
}
