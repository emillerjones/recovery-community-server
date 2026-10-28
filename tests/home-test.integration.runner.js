import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";

process.env.DB_CLIENT_MODE = "single";
const { default: db } = await import("#db/client");
const { default: app } = await import("#app");
const { createToken } = await import("#utils/jwt");
const { HOME_TEST_SECTIONS, HOME_TEST_INITIAL_CONTENT } = await import("#utils/homeTestContent");
await db.connect();
await db.query("BEGIN");
let server;
try {
  const schema = `home_test_check_${Date.now()}`;
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`SET LOCAL search_path TO ${schema}`);
  await db.query(`CREATE TABLE users (
    user_id INT PRIMARY KEY, role_id INT, auth_version INT DEFAULT 0,
    account_status TEXT DEFAULT 'approved', active BOOLEAN DEFAULT TRUE, deleted_at TIMESTAMPTZ
  )`);
  await db.query("INSERT INTO users(user_id,role_id) VALUES (1,1),(2,10),(3,50),(4,100)");
  const migration = (await fs.readFile(new URL("../db/migrations/030_add_home_test_content.sql", import.meta.url), "utf8"))
    .replace(/^BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "");
  await db.query(migration);
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/home`;
  const response = await fetch(endpoint);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-robots-tag"), null);
  let saved = await response.json();
  assert.deepEqual(saved.content, HOME_TEST_INITIAL_CONTENT);
  assert.deepEqual(saved.sections, HOME_TEST_SECTIONS);
  assert.equal(saved.sections.reduce((sum, section) => sum + section.fields.length, 0), 40);
  const patch = (id, fields, userId = 1, revision = saved.revision, extras = {}) => fetch(`${endpoint}/sections/${id}`, {
    method: "PATCH", headers: {
      "Content-Type": "application/json",
      ...(userId ? { Authorization: `Bearer ${createToken({ id: userId, auth_version: 0, role_id: 1 })}` } : {}),
    }, body: JSON.stringify({ fields, revision, ...extras }),
  });
  assert.equal((await patch("hero", saved.content.hero, null)).status, 401);
  for (const userId of [2, 3, 4]) assert.equal((await patch("hero", saved.content.hero, userId)).status, 403);
  for (const column of ["active", "account_status", "deleted_at"]) {
    const changed = column === "active" ? "FALSE" : column === "account_status" ? "'pending'" : "NOW()";
    const reset = column === "active" ? "TRUE" : column === "account_status" ? "'approved'" : "NULL";
    await db.query(`UPDATE users SET ${column} = ${changed} WHERE user_id = 1`);
    assert.equal((await patch("hero", saved.content.hero)).status, 403);
    await db.query(`UPDATE users SET ${column} = ${reset} WHERE user_id = 1`);
  }
  assert.equal((await patch("unknown", saved.content.hero)).status, 400);
  assert.equal((await patch("__proto__", saved.content.hero)).status, 400);
  for (const revision of [0, -1, null, "1", 1.5]) assert.equal((await patch("hero", saved.content.hero, 1, revision)).status, 400);
  for (const section of HOME_TEST_SECTIONS) {
    for (const field of section.fields) {
      for (const value of [" ", 42, "x".repeat(field.maxLength + 1)]) {
        assert.equal((await patch(section.id, { ...saved.content[section.id], [field.key]: value })).status, 400);
      }
    }
    const missing = { ...saved.content[section.id] }; delete missing[section.fields[0].key];
    assert.equal((await patch(section.id, missing)).status, 400);
    assert.equal((await patch(section.id, { ...saved.content[section.id], buttonLabel: "Not editable" })).status, 400);
    const fields = Object.fromEntries(section.fields.map(field => [field.key, `New ${field.key}`]));
    const before = structuredClone(saved.content);
    const result = await patch(section.id, fields, 1, saved.revision, { content: {}, otherSections: {} });
    assert.equal(result.status, 200);
    const next = await result.json();
    assert.equal(next.revision, saved.revision + 1);
    assert.deepEqual(next.content, { ...before, [section.id]: fields }, "Only the selected section changes");
    assert.equal((await patch(section.id, fields, 1, saved.revision)).status, 409);
    saved = next;
  }
  await db.query(migration);
  assert.deepEqual((await (await fetch(endpoint)).json()).content, saved.content, "Migration rerun must preserve edits");
  const races = await Promise.all([patch("hero", saved.content.hero), patch("purpose", saved.content.purpose)]);
  assert.deepEqual(races.map(result => result.status).sort(), [200, 409]);
  assert.equal((await db.query("SELECT updated_by FROM home_test_pages")).rows[0].updated_by, 1);
  console.log("PASS Home - Test: exact seed, public read, Owner-only saves, account restrictions, validation of all 40 fields, fixed field scope, independent sections, stale/concurrent saves, migration idempotence.");
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.query("ROLLBACK");
  await db.end();
}
