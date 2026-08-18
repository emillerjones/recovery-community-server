import db from "#db/client";

export async function getDiscount2Page() {
  const { rows: [page] } = await db.query(
    `SELECT page_key, content, revision, updated_by, created_at, updated_at
     FROM discount_pages
     WHERE page_key = 'discountlinks2'`
  );
  return page;
}

export async function updateDiscount2Page({ content, revision, updatedBy }) {
  const { rows: [page] } = await db.query(
    `UPDATE discount_pages
     SET content = $1::jsonb,
         revision = revision + 1,
         updated_by = $2,
         updated_at = NOW()
     WHERE page_key = 'discountlinks2' AND revision = $3
     RETURNING page_key, content, revision, updated_by, created_at, updated_at`,
    [JSON.stringify(content), updatedBy, revision]
  );
  return page;
}
