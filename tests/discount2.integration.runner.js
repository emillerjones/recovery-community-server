import assert from "node:assert/strict";
import http from "node:http";

process.env.DB_CLIENT_MODE = "single";

const { default: db } = await import("#db/client");
const { default: app } = await import("#app");
const { createToken } = await import("#utils/jwt");

await db.connect();
await db.query("BEGIN");
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const endpoint = `http://127.0.0.1:${port}/api/discount2`;

try {
  const publicResponse = await fetch(endpoint);
  assert.equal(publicResponse.status, 200);
  const original = await publicResponse.json();
  assert.equal(original.content.categories.length, 5);

  const anonymousResponse = await fetch(endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(original),
  });
  assert.equal(anonymousResponse.status, 401);

  const { rows: [member] } = await db.query(
    `SELECT user_id, auth_version FROM users
     WHERE role_id > 1 AND account_status = 'approved' AND active = TRUE AND deleted_at IS NULL
     ORDER BY user_id LIMIT 1`
  );
  if (member) {
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${createToken({ id: member.user_id, auth_version: member.auth_version })}`, "Content-Type": "application/json" },
      body: JSON.stringify(original),
    });
    assert.equal(response.status, 403);
  }

  const { rows: [owner] } = await db.query(
    `SELECT user_id, auth_version FROM users
     WHERE role_id = 1 AND account_status = 'approved' AND active = TRUE AND deleted_at IS NULL
     ORDER BY user_id LIMIT 1`
  );
  assert.ok(owner);
  const token = createToken({ id: owner.user_id, auth_version: owner.auth_version });
  const edited = structuredClone(original.content);
  edited.categories[0].brands.push({
    id: "integration-test-brand",
    name: "Integration Test Brand",
    code: null,
    url: "https://example.com/test",
    logo: null,
    note: "Temporary test brand",
    active: false,
  });

  const saveResponse = await fetch(endpoint, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: edited, revision: original.revision }),
  });
  assert.equal(saveResponse.status, 200);
  const saved = await saveResponse.json();
  assert.equal(saved.revision, original.revision + 1);
  assert.equal(saved.content.categories[0].brands.at(-1).name, "Integration Test Brand");

  const staleResponse = await fetch(endpoint, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: original.content, revision: original.revision }),
  });
  assert.equal(staleResponse.status, 409);

  console.log("Discount2 integration test passed.");
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await db.query("ROLLBACK");
  await db.end();
}
