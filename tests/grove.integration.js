import assert from "node:assert/strict";
import fs from "node:fs/promises";
import db from "#db/client";
import { getTodayGrove, toggleCheckinSupport, upsertTodayCheckin } from "#db/queries/grove";

const schemaName = "codex_grove_integration";
const checkinDate = new Date().toISOString().slice(0, 10);

await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await db.query(`CREATE SCHEMA ${schemaName}`);
  await db.query(`SET LOCAL search_path TO ${schemaName}`);
  await db.query(await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
  await db.query("INSERT INTO user_roles (role_id, role_name) VALUES (100, 'Member'), (1000, 'System')");
  await db.query(
    `INSERT INTO users (role_id, email, password, username, is_system, account_status)
     VALUES (1000, 'system@example.invalid', 'unused', 'Recovery Community', TRUE, 'approved')`
  );
  await db.query("INSERT INTO forum_categories (name, slug) VALUES ('Introductions', 'introductions')");
  const { rows: members } = await db.query(
    `INSERT INTO users (role_id, email, password, username, account_status)
     VALUES (100, 'grove-one@example.com', 'unused', 'grove-one', 'approved'),
            (100, 'grove-two@example.com', 'unused', 'grove-two', 'approved')
     RETURNING *`
  );

  const first = await upsertTodayCheckin({
    userId: members[0].user_id, checkinDate, mood: "hopeful", note: "Glad to be here.", openToSupport: false,
  });
  assert.equal(first.mood, "hopeful");
  const updated = await upsertTodayCheckin({
    userId: members[0].user_id, checkinDate, mood: "one_day", note: "Taking today slowly.", openToSupport: true,
  });
  assert.equal(updated.checkin_id, first.checkin_id);
  assert.equal(updated.open_to_support, true);

  const supported = await toggleCheckinSupport({ checkinId: first.checkin_id, userId: members[1].user_id });
  assert.equal(supported.supported, true);
  assert.equal(supported.support_count, 1);
  const removed = await toggleCheckinSupport({ checkinId: first.checkin_id, userId: members[1].user_id });
  assert.equal(removed.supported, false);
  assert.equal(removed.support_count, 0);
  assert.equal(await toggleCheckinSupport({ checkinId: first.checkin_id, userId: members[0].user_id }), null);

  const grove = await getTodayGrove(members[1].user_id, checkinDate);
  assert.equal(grove.summary.checkin_count, 1);
  assert.equal(grove.checkins[0].note, "Taking today slowly.");
  console.log("GROVE_INTEGRATION_OK daily_upsert=1 support_toggle=protected shared_view=1");
} finally {
  await db.query("ROLLBACK").catch(() => {});
  await db.end();
}
