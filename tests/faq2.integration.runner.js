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
const endpoint = `http://127.0.0.1:${port}/api/faq2`;

try {
  const publicResponse = await fetch(endpoint);
  assert.equal(publicResponse.status, 200);
  const original = await publicResponse.json();
  assert.ok(Array.isArray(original.content.groups));
  assert.ok(original.content.groups.length > 0);

  const anonymousResponse = await fetch(endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(original),
  });
  assert.equal(anonymousResponse.status, 401);

  const { rows: [member] } = await db.query(
    `SELECT user_id, auth_version
     FROM users
     WHERE role_id > 1 AND account_status = 'approved' AND active = TRUE AND deleted_at IS NULL
     ORDER BY user_id LIMIT 1`
  );
  if (member) {
    const memberResponse = await fetch(endpoint, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${createToken({ id: member.user_id, auth_version: member.auth_version })}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(original),
    });
    assert.equal(memberResponse.status, 403);
  }

  const { rows: [owner] } = await db.query(
    `SELECT user_id, auth_version
     FROM users
     WHERE role_id = 1 AND account_status = 'approved' AND active = TRUE AND deleted_at IS NULL
     ORDER BY user_id LIMIT 1`
  );
  assert.ok(owner, "An approved owner account is required for this integration test.");
  const ownerToken = createToken({ id: owner.user_id, auth_version: owner.auth_version });
  const editedContent = structuredClone(original.content);
  editedContent.hero.intro = `${editedContent.hero.intro} Integration test.`;

  const saveResponse = await fetch(endpoint, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: editedContent, revision: original.revision }),
  });
  assert.equal(saveResponse.status, 200);
  const saved = await saveResponse.json();
  assert.equal(saved.revision, original.revision + 1);
  assert.equal(saved.content.hero.intro, editedContent.hero.intro);

  const staleResponse = await fetch(endpoint, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: original.content, revision: original.revision }),
  });
  assert.equal(staleResponse.status, 409);

  console.log("FAQ2 integration test passed.");
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await db.query("ROLLBACK");
  await db.end();
}
