import assert from "node:assert/strict";
import fs from "node:fs/promises";
import db from "#db/client";
import { getMessages, getOrCreateConversation, sendMessage } from "#db/queries/messages";

const schemaName = "codex_direct_message_paging_integration";

await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await db.query(`CREATE SCHEMA ${schemaName}`);
  await db.query(`SET LOCAL search_path TO ${schemaName}`);
  await db.query(await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));

  await db.query("INSERT INTO user_roles (role_id, role_name) VALUES (100, 'Member')");
  const { rows: users } = await db.query(
    `INSERT INTO users (role_id, email, password, username, account_status)
     VALUES (100, 'page-a@example.com', 'unused', 'page-a', 'pending'),
            (100, 'page-b@example.com', 'unused', 'page-b', 'pending'),
            (100, 'page-c@example.com', 'unused', 'page-c', 'pending')
     RETURNING user_id, username`
  );
  const [a, b, c] = ["page-a", "page-b", "page-c"].map(
    (name) => users.find((user) => user.username === name)
  );
  const longConversation = await getOrCreateConversation(a.user_id, b.user_id);
  const otherConversation = await getOrCreateConversation(a.user_id, c.user_id);

  // 130 messages one minute apart, alternating senders. Insert them out of
  // order so the test proves ordering comes from created_at, not insert order.
  const total = 130;
  const order = Array.from({ length: total }, (_, index) => index).reverse();
  for (const index of order) {
    await db.query(
      `INSERT INTO direct_messages (conversation_id, sender_id, body, created_at)
       VALUES ($1, $2, $3, TIMESTAMPTZ '2026-01-01 00:00:00+00' + make_interval(mins => $4))`,
      [longConversation.conversation_id, index % 2 ? b.user_id : a.user_id, `message ${index}`, index]
    );
  }
  await sendMessage({ conversationId: otherConversation.conversation_id, senderId: c.user_id, body: "elsewhere" });

  // The default load returns the NEWEST 100, still in reading order.
  const latest = await getMessages(longConversation.conversation_id);
  assert.equal(latest.length, 100);
  assert.equal(latest.at(-1).body, "message 129", "newest message must be included");
  assert.equal(latest[0].body, "message 30");
  for (let index = 1; index < latest.length; index += 1) {
    assert.ok(latest[index - 1].created_at < latest[index].created_at, "messages stay oldest-first");
  }

  // A message sent now (after the history) appears at the end of the first page.
  const fresh = await sendMessage({
    conversationId: longConversation.conversation_id, senderId: a.user_id, body: "just sent",
  });
  const afterSend = await getMessages(longConversation.conversation_id);
  assert.equal(afterSend.at(-1).message_id, fresh.message_id);

  // Page backwards with the API's page sizes (limit + 1 detects more history).
  const firstPage = await getMessages(longConversation.conversation_id, 101);
  assert.equal(firstPage.length, 101, "an extra row signals older history");
  const shown = firstPage.slice(1);
  const seen = [...shown];
  let cursor = shown[0].message_id;
  let pages = 0;
  for (;;) {
    const rows = await getMessages(longConversation.conversation_id, 51, cursor);
    const hasMore = rows.length > 50;
    const page = hasMore ? rows.slice(1) : rows;
    seen.unshift(...page);
    pages += 1;
    if (!hasMore) break;
    cursor = page[0].message_id;
  }
  assert.equal(pages, 1);
  assert.equal(seen.length, total + 1, "every message is reachable exactly once");
  assert.equal(new Set(seen.map((message) => message.message_id)).size, seen.length, "no duplicates");
  assert.equal(seen[0].body, "message 0");
  assert.deepEqual(
    seen.slice(0, total).map((message) => message.body),
    Array.from({ length: total }, (_, index) => `message ${index}`),
    "no gaps or reordering across pages"
  );

  // Messages that share a timestamp still page cleanly by message_id.
  await db.query(
    `INSERT INTO direct_messages (conversation_id, sender_id, body, created_at)
     SELECT $1, $2, 'tie ' || n, TIMESTAMPTZ '2025-06-01 00:00:00+00'
     FROM generate_series(1, 5) n`,
    [otherConversation.conversation_id, a.user_id]
  );
  const tieNewest = await getMessages(otherConversation.conversation_id, 3);
  const tieOlder = await getMessages(otherConversation.conversation_id, 10, tieNewest[0].message_id);
  assert.equal(tieNewest.length + tieOlder.length, 6);
  assert.equal(new Set([...tieNewest, ...tieOlder].map((message) => message.message_id)).size, 6);

  // A cursor from a different conversation must not leak or page anything.
  const foreignCursor = await getMessages(otherConversation.conversation_id, 50, fresh.message_id);
  assert.deepEqual(foreignCursor, []);
  const missingCursor = await getMessages(longConversation.conversation_id, 50, 999999);
  assert.deepEqual(missingCursor, []);

  console.log("DIRECT_MESSAGE_PAGING_INTEGRATION_OK newest_first_page=covered paging=covered ties=covered cursor_isolation=covered");
} finally {
  await db.query("ROLLBACK").catch(() => {});
  await db.end();
}
