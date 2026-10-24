import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";

process.env.DB_CLIENT_MODE = "single";
const { default: db } = await import("#db/client");
const { default: app } = await import("#app");
const { createToken } = await import("#utils/jwt");
await db.connect();
await db.query("BEGIN");
const schema = `resources_test_${Date.now()}`;
let server;
try {
  // All fixtures and edits live in this transaction's private schema.
  // Public tables and real member accounts are never edited.
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`SET LOCAL search_path TO ${schema}`);
  await db.query(`CREATE TABLE users (
    user_id INT PRIMARY KEY, role_id INT, auth_version INT DEFAULT 0,
    account_status TEXT DEFAULT 'approved', active BOOLEAN DEFAULT TRUE, deleted_at TIMESTAMPTZ
  )`);
  await db.query("INSERT INTO users(user_id,role_id) VALUES (1,1),(2,10),(3,50),(4,100)");
  const migration = (await fs.readFile(new URL("../db/migrations/029_add_resources_content.sql", import.meta.url), "utf8"))
    .replace(/^BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "");
  await db.query(migration);
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/resources`;
  const patch = (body, userId) => fetch(endpoint, {
    method: "PATCH", headers: {
      "Content-Type": "application/json",
      ...(userId ? { Authorization: `Bearer ${createToken({ id: userId, auth_version: 0 })}` } : {}),
    }, body: JSON.stringify(body),
  });
  const response = await fetch(endpoint);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const initial = await response.json();
  assert.equal(initial.content.categories.length, 5);
  assert.equal(initial.content.categories.reduce((n, g) => n + g.links.length, 0), 30);
  assert.equal((await patch(initial)).status, 401);
  for (const user of [2, 3, 4]) assert.equal((await patch(initial, user)).status, 403);
  await db.query("UPDATE users SET active = FALSE WHERE user_id = 1");
  assert.equal((await patch(initial, 1)).status, 403);
  await db.query("UPDATE users SET active = TRUE WHERE user_id = 1");
  for (const revision of [null, "1", 0, -1, 1.2]) assert.equal((await patch({ ...initial, revision }, 1)).status, 400);
  const invalid = [
    content => { content.categories[0].links[0].url = "javascript:alert(1)"; },
    content => { content.categories[0].links[0].url = "https://user:password@example.org"; },
    content => { content.categories[0].links[0].url = "not a url"; },
    content => { content.categories[0].links[0].text = " "; },
    content => { content.categories[0].links[0].tag = {}; },
    content => { content.categories[0].section = "other"; },
    content => { content.categories[1].id = content.categories[0].id; },
    content => { content.categories[1].links[0].id = content.categories[0].links[0].id; },
    content => { content.categories[0].id = "<script>"; },
    content => { content.hero.title = "a".repeat(181); },
    content => { content.categories.push(...Array(21).fill(content.categories[0])); },
  ];
  for (const change of invalid) {
    const content = structuredClone(initial.content); change(content);
    assert.equal((await patch({ ...initial, content }, 1)).status, 400);
  }
  const content = structuredClone(initial.content);
  content.categories.reverse();
  content.categories[0].title = "Renamed category";
  content.categories[0].links.reverse();
  content.categories[0].links.pop();
  content.categories.push({ id: "support-test", title: "Support", section: "support", links: [{ id: "new-resource", text: "New resource", url: "https://example.org", tag: "Organization" }] });
  const savedResponse = await patch({ content, revision: initial.revision }, 1);
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.deepEqual(saved.content, content);
  assert.equal(saved.revision, initial.revision + 1);
  assert.equal((await db.query("SELECT updated_by FROM resource_pages")).rows[0].updated_by, 1);
  assert.equal((await patch(initial, 1)).status, 409);
  assert.deepEqual((await (await fetch(endpoint)).json()).content, content);
  await db.query(migration);
  assert.deepEqual((await (await fetch(endpoint)).json()).content, content, "Rerunning migration preserves saved content");
  const races = await Promise.all([patch(saved, 1), patch(saved, 1)]);
  assert.deepEqual(races.map(result => result.status).sort(), [200, 409]);
  let latest = await (await fetch(endpoint)).json();
  const itemPatch = (edit, userId = 1, revision = latest.revision) => fetch(endpoint + "/items", {
    method: "PATCH", headers: {
      "Content-Type": "application/json",
      ...(userId ? { Authorization: `Bearer ${createToken({ id: userId, auth_version: 0 })}` } : {}),
    }, body: JSON.stringify({ ...edit, revision }),
  });
  const saveItem = async edit => {
    const response = await itemPatch(edit);
    assert.equal(response.status, 200, await response.clone().text());
    latest = await response.json();
  };
  const categoryId = latest.content.categories[0].id;
  const resourceId = latest.content.categories[0].links[0].id;
  assert.equal((await itemPatch({ action: "delete-category", categoryId }, null)).status, 401);
  for (const roleId of [2, 3, 4]) assert.equal((await itemPatch({ action: "delete-category", categoryId }, roleId)).status, 403);
  await db.query("UPDATE users SET active = FALSE WHERE user_id = 1");
  assert.equal((await itemPatch({ action: "delete-category", categoryId })).status, 403);
  await db.query("UPDATE users SET active = TRUE WHERE user_id = 1");
  for (const edit of [
    { action: "no-such-action", categoryId },
    { action: "save-resource", categoryId: "missing", resource: { id: "new" } },
    { action: "delete-resource", categoryId, resourceId: "missing" },
    { action: "reorder-categories", ids: [categoryId, categoryId] },
    { action: "reorder-resources", categoryId, ids: [resourceId] },
    { action: "save-resource", categoryId, resource: { ...latest.content.categories[0].links[0], url: "javascript:alert(1)" } },
  ]) assert.ok([400, 404].includes((await itemPatch(edit)).status));
  assert.equal((await itemPatch({ action: "delete-category", categoryId }, 1, 0)).status, 400);
  assert.equal((await itemPatch({ action: "delete-category", categoryId }, 1, 1)).status, 409);
  const beforeCategory = structuredClone(latest.content);
  await saveItem({ action: "save-category", categoryId, category: { title: "Saved category", links: [] } });
  assert.deepEqual(latest.content.categories[0].links, beforeCategory.categories[0].links, "Category save preserves children");
  assert.deepEqual(latest.content.hero, beforeCategory.hero);
  const beforeResource = structuredClone(latest.content);
  const resource = { ...latest.content.categories[0].links[0], text: "Only this resource changed" };
  await saveItem({ action: "save-resource", categoryId, resource, category: { title: "Must not leak" }, pageText: { hero: {} } });
  const expected = structuredClone(beforeResource);
  expected.categories[0].links[0] = resource;
  assert.deepEqual(latest.content, expected, "Resource save changes exactly the selected resource");
  const beforePage = structuredClone(latest.content);
  await saveItem({ action: "save-page-text", pageText: { hero: { ...beforePage.hero, title: "Saved page title" }, learnIntro: beforePage.learnIntro, supportIntro: beforePage.supportIntro }, categories: [] });
  assert.deepEqual(latest.content.categories, beforePage.categories, "Page text save preserves categories and resources");
  const ids = latest.content.categories.map(item => item.id).reverse();
  await saveItem({ action: "reorder-categories", ids });
  assert.deepEqual(latest.content.categories.map(item => item.id), ids);
  const linkIds = latest.content.categories.find(item => item.id === categoryId).links.map(item => item.id).reverse();
  await saveItem({ action: "reorder-resources", categoryId, ids: linkIds });
  assert.deepEqual(latest.content.categories.find(item => item.id === categoryId).links.map(item => item.id), linkIds);
  await saveItem({ action: "save-category", categoryId: "new-parent", category: { title: "New parent", links: [{ id: "ignored" }] } });
  assert.deepEqual(latest.content.categories.at(-1).links, []);
  await saveItem({ action: "save-resource", categoryId: "new-parent", resource: { id: "new-child", text: "New child", url: "https://example.org", tag: "Study" } });
  await saveItem({ action: "delete-resource", categoryId: "new-parent", resourceId: "new-child" });
  assert.deepEqual(latest.content.categories.at(-1).links, []);
  await saveItem({ action: "delete-category", categoryId: "new-parent" });
  assert.ok(!latest.content.categories.some(item => item.id === "new-parent"));
  const itemRaces = await Promise.all([itemPatch({ action: "save-category", categoryId, category: { title: "Concurrent edit" } }), itemPatch({ action: "save-category", categoryId, category: { title: "Other edit" } })]);
  assert.deepEqual(itemRaces.map(result => result.status).sort(), [200, 409]);
  latest = await (await fetch(endpoint)).json();
  assert.equal((await patch({ ...latest, content: { ...latest.content, categories: [] } }, 1)).status, 200);
  assert.deepEqual((await (await fetch(endpoint)).json()).content.categories, []);
  console.log("PASS Resources: public read, both write endpoints, all role boundaries, suspended owner, validation, category/link CRUD and ordering, isolated item/page saves, stale/concurrent saves, empty state, migration idempotence.");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.query("ROLLBACK");
  await db.end();
}
