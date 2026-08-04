import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import fs from "node:fs/promises";
import db from "#db/client";
import { getUserByEmailAndPassword } from "#db/queries/users";
import { createPasswordResetToken, resetPassword } from "#db/queries/passwordReset";
import { createSecureToken, hashSecret } from "#utils/secureTokens";

const schemaName = "codex_password_reset_integration";

await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`CREATE SCHEMA ${schemaName}`);
  await db.query(`SET LOCAL search_path TO ${schemaName}`);
  await db.query(await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
  const migration = (await fs.readFile(
    new URL("../db/migrations/016_add_password_reset.sql", import.meta.url),
    "utf8"
  )).replace(/^BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "");
  await db.query(migration);
  await db.query("INSERT INTO user_roles (role_id, role_name) VALUES (100, 'Member')");

  const { rows: [passwordUser] } = await db.query(
    `INSERT INTO users (role_id, email, password, username, account_status)
     VALUES (100, 'reset@example.com', $1, 'reset-member', 'pending')
     RETURNING *`,
    [await bcrypt.hash("old-password-42", 10)]
  );
  assert.equal(passwordUser.auth_version, 0);
  assert.equal(await createPasswordResetToken("missing@example.com", "unused-hash"), undefined);

  const firstReset = createSecureToken();
  assert.equal(
    (await createPasswordResetToken(passwordUser.email, firstReset.tokenHash)).user_id,
    passwordUser.user_id
  );
  assert.equal(await resetPassword(hashSecret("not-a-real-token"), "new-password-42"), undefined);
  assert.ok(await getUserByEmailAndPassword(passwordUser.email, "old-password-42"));

  const resetUser = await resetPassword(firstReset.tokenHash, "new-password-42");
  assert.equal(resetUser.auth_version, 1);
  assert.equal(await getUserByEmailAndPassword(passwordUser.email, "old-password-42"), null);
  assert.ok(await getUserByEmailAndPassword(passwordUser.email, "new-password-42"));
  assert.equal(await resetPassword(firstReset.tokenHash, "another-password-42"), undefined);

  const expiredReset = createSecureToken();
  await createPasswordResetToken(passwordUser.email, expiredReset.tokenHash);
  await db.query(
    "UPDATE password_reset_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = $1",
    [expiredReset.tokenHash]
  );
  assert.equal(await resetPassword(expiredReset.tokenHash, "another-password-42"), undefined);

  const replacedReset = createSecureToken();
  const currentReset = createSecureToken();
  await createPasswordResetToken(passwordUser.email, replacedReset.tokenHash);
  await createPasswordResetToken(passwordUser.email, currentReset.tokenHash);
  assert.equal(await resetPassword(replacedReset.tokenHash, "another-password-42"), undefined);
  assert.equal((await resetPassword(currentReset.tokenHash, "another-password-42")).auth_version, 2);

  console.log("Password reset integration test passed: missing accounts, valid links, expiration, one-use links, password hashing, replacement, and session versioning.");
} finally {
  await db.query("ROLLBACK");
  await db.end();
}
