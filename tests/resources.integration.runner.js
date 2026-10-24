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
  const latest = await (await fetch(endpoint)).json();
  assert.equal((await patch({ ...latest, content: { ...latest.content, categories: [] } }, 1)).status, 200);
  assert.deepEqual((await (await fetch(endpoint)).json()).content.categories, []);
  console.log("PASS Resources: public read, all role boundaries, suspended owner, validation, category/link CRUD and ordering, stale/concurrent saves, empty state, migration idempotence.");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.query("ROLLBACK");
  await db.end();
}
