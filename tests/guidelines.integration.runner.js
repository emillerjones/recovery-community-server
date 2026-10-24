import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";

process.env.DB_CLIENT_MODE = "single";
const { default: db } = await import("#db/client");
const { default: app } = await import("#app");
const { createToken } = await import("#utils/jwt");
const { GUIDELINES_INITIAL_CONTENT, GUIDELINES_PAGE_FIELDS } = await import("#utils/guidelinesContent");
await db.connect();
await db.query("BEGIN");
let server;
try {
  const schema = `guidelines_check_${Date.now()}`;
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`SET LOCAL search_path TO ${schema}`);
  await db.query(`CREATE TABLE users (user_id INT PRIMARY KEY, role_id INT, auth_version INT DEFAULT 0, account_status TEXT DEFAULT 'approved', active BOOLEAN DEFAULT TRUE, deleted_at TIMESTAMPTZ)`);
  await db.query("INSERT INTO users(user_id,role_id) VALUES (1,1),(2,10),(3,50),(4,100)");
  const migration = (await fs.readFile(new URL("../db/migrations/031_add_guidelines_content.sql", import.meta.url), "utf8")).replace(/^BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "");
  await db.query(migration);
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/guidelines`;
  const response = await fetch(endpoint);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  let saved = await response.json();
  assert.deepEqual(saved.content, GUIDELINES_INITIAL_CONTENT);
  assert.equal(saved.content.items.length, 8);
  const patch = (edit, userId = 1, revision = saved.revision) => fetch(endpoint + "/items", {
    method: "PATCH", headers: { "Content-Type": "application/json", ...(userId ? { Authorization: `Bearer ${createToken({ id: userId, auth_version: 0, role_id: 1 })}` } : {}) },
    body: JSON.stringify({ ...edit, revision }),
  });
  const commit = async edit => {
    const result = await patch(edit);
    assert.equal(result.status, 200, await result.clone().text());
    const next = await result.json(); assert.equal(next.revision, saved.revision + 1); saved = next;
  };
  const edit = { action: "save-item", item: saved.content.items[0] };
  assert.equal((await patch(edit, null)).status, 401);
  for (const user of [2, 3, 4]) assert.equal((await patch(edit, user)).status, 403);
  for (const column of ["active", "account_status", "deleted_at"]) {
    const changed = column === "active" ? "FALSE" : column === "account_status" ? "'pending'" : "NOW()";
    const reset = column === "active" ? "TRUE" : column === "account_status" ? "'approved'" : "NULL";
    await db.query(`UPDATE users SET ${column} = ${changed} WHERE user_id = 1`);
    assert.equal((await patch(edit)).status, 403);
    await db.query(`UPDATE users SET ${column} = ${reset} WHERE user_id = 1`);
  }
  for (const revision of [0, -1, null, "1", 1.5]) assert.equal((await patch(edit, 1, revision)).status, 400);
  for (const invalid of [
    { action: "unknown" }, { action: "save-item", item: null },
    { action: "save-item", item: { ...edit.item, title: " " } },
    { action: "save-item", item: { ...edit.item, title: "a".repeat(241) } },
    { action: "save-item", item: { ...edit.item, text: 42 } },
    { action: "save-item", item: { ...edit.item, text: "a".repeat(6001) } },
    { action: "save-item", item: { ...edit.item, id: "<script>" } },
    { action: "save-item", item: { ...edit.item, icon: "arbitrary" } },
    { action: "save-page", page: {} },
    { action: "reorder-items", ids: [] },
    { action: "reorder-items", ids: saved.content.items.map(() => "01") },
  ]) assert.equal((await patch(invalid)).status, 400);
  assert.equal((await patch({ action: "delete-item", itemId: "missing" })).status, 404);
  for (const field of GUIDELINES_PAGE_FIELDS) assert.equal((await patch({ action: "save-page", page: { ...saved.content.page, [field.key]: "x".repeat(field.maxLength + 1) } })).status, 400);
  const before = structuredClone(saved.content);
  await commit({ action: "save-item", item: { ...edit.item, title: "Updated privacy rule" }, page: {}, items: [] });
  assert.deepEqual(saved.content, { ...before, items: before.items.map((item, i) => i === 0 ? { ...item, title: "Updated privacy rule" } : item) });
  const itemSnapshot = structuredClone(saved.content.items);
  await commit({ action: "save-page", page: { ...saved.content.page, intro: "Updated introduction" }, items: [] });
  assert.deepEqual(saved.content.items, itemSnapshot);
  await commit({ action: "save-item", item: { id: "new-rule", icon: "Heart", title: "New rule", text: "New explanation" } });
  assert.equal(saved.content.items.at(-1).id, "new-rule");
  const ids = saved.content.items.map(item => item.id).reverse();
  await commit({ action: "reorder-items", ids });
  assert.deepEqual(saved.content.items.map(item => item.id), ids);
  await commit({ action: "delete-item", itemId: "new-rule" });
  assert.equal(saved.content.items.length, 8);
  await db.query(migration);
  assert.deepEqual((await (await fetch(endpoint)).json()).content, saved.content, "Migration reruns preserve published changes");
  assert.equal((await patch(edit, 1, 1)).status, 409);
  const race = await Promise.all([patch(edit), patch(edit)]);
  assert.deepEqual(race.map(result => result.status).sort(), [200, 409]);
  saved = await (await fetch(endpoint)).json();
  for (const item of saved.content.items.slice(1)) await commit({ action: "delete-item", itemId: item.id });
  assert.equal((await patch({ action: "delete-item", itemId: saved.content.items[0].id })).status, 400);
  assert.equal((await db.query("SELECT updated_by FROM guidelines_pages")).rows[0].updated_by, 1);
  console.log("PASS Guidelines: exact original seed, public read, Owner/account permissions, field validation, independent saves, additions/deletions/order, last-rule protection, stale/concurrent writes, migration idempotence.");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.query("ROLLBACK"); await db.end();
}
