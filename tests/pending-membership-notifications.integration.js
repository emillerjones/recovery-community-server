import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import fs from "node:fs/promises";
import db from "#db/client";
import { createPendingApplicationNotifications } from "#db/queries/notifications";

const schemaName = "codex_pending_membership_notifications";

async function insertUser({ roleId, username, status = "approved", active = true, deleted = false, system = false }) {
  const { rows: [user] } = await db.query(
    `INSERT INTO users (
       role_id, email, password, username, account_status, active, deleted_at, is_system
     ) VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN NOW() ELSE NULL END, $8)
     RETURNING *`,
    [roleId, `${username}@example.com`, await bcrypt.hash("test-password-42", 4), username, status, active, deleted, system]
  );
  return user;
}

await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`CREATE SCHEMA ${schemaName}`);
  await db.query(`SET LOCAL search_path TO ${schemaName}`);
  await db.query(await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
  await db.query(
    "INSERT INTO user_roles (role_id, role_name) VALUES (1, 'Owner'), (10, 'Administrator'), (50, 'Moderator'), (100, 'Member')"
  );

  const owner = await insertUser({ roleId: 1, username: "owner" });
  const admin = await insertUser({ roleId: 10, username: "administrator" });
  await insertUser({ roleId: 50, username: "moderator" });
  await insertUser({ roleId: 10, username: "inactive-admin", active: false });
  await insertUser({ roleId: 1, username: "deleted-owner", deleted: true });
  await insertUser({ roleId: 1, username: "system-owner", system: true });
  const applicant = await insertUser({ roleId: 100, username: "new-applicant", status: "pending" });

  const notifications = await createPendingApplicationNotifications(applicant.user_id);
  assert.deepEqual(
    notifications.map(({ user_id }) => user_id).sort((a, b) => a - b),
    [owner.user_id, admin.user_id].sort((a, b) => a - b)
  );
  assert.ok(notifications.every(({ type }) => type === "pending_membership_application"));
  assert.ok(notifications.every(({ actor_id }) => actor_id === applicant.user_id));
  assert.ok(notifications.every(({ actor_username }) => actor_username === applicant.username));

  console.log("Pending membership notification test passed: active owners/admins included; moderators, inactive, deleted, system, and member accounts excluded.");
} finally {
  await db.query("ROLLBACK");
  await db.end();
}
