import assert from "node:assert/strict";
import fs from "node:fs/promises";
import db from "#db/client";
import { createUser, hardDeleteTestUser, updateOwnProfile } from "#db/queries/users";
import { createRegistration, verifyEmail } from "#db/queries/registration";
import {
  createPersonalInvite, createSharedCode, reviewApplication,
} from "#db/queries/admissions";
import { createSecureToken, hashSecret } from "#utils/secureTokens";

const schemaName = "codex_registration_integration";

function application(overrides = {}) {
  return {
    email: "applicant@example.com",
    username: "applicant",
    password: "correct-horse-42",
    reasonForJoining: "I would value private peer support.",
    howFound: "The community website.",
    admissionMethod: "standard",
    ...overrides,
  };
}

await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`CREATE SCHEMA ${schemaName}`);
  await db.query(`SET LOCAL search_path TO ${schemaName}`);
  await db.query(await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
  await db.query(`INSERT INTO user_roles (role_id, role_name) VALUES
    (1, 'owner'), (10, 'administrator'), (50, 'moderator'), (100, 'member')`);
  const owner = await createUser("owner@example.com", "owner", "owner-password", 1);
  const completedProfile = await updateOwnProfile(owner.user_id, {
    bio: "Community founder", phoneNumber: "555-0100",
    dateOfBirth: "1980-01-02", gender: "Woman", avatarUrl: "preset:Butterfly:lavender",
  });
  assert.equal(completedProfile.bio, "Community founder");
  assert.equal(new Date(completedProfile.date_of_birth).toISOString().slice(0, 10), "1980-01-02");
  assert.equal(completedProfile.avatar_url, "preset:Butterfly:lavender");

  // Flow 1: standard applicant verifies, becomes pending, then is approved.
  const standardSecret = createSecureToken();
  const standard = await createRegistration(application({ tokenHash: standardSecret.tokenHash }));
  assert.equal(standard.account_status, "unverified");
  assert.equal((await verifyEmail(hashSecret(standardSecret.token))).account_status, "pending");
  const { rows: [pendingApplication] } = await db.query(
    "SELECT application_id FROM membership_applications WHERE user_id = $1", [standard.user_id]
  );
  assert.equal((await reviewApplication(pendingApplication.application_id, owner.user_id, "approved", "")).account_status, "approved");
  assert.equal((await hardDeleteTestUser(standard.user_id)).email, standard.email);

  // Flow 2: a private, one-use invitation bypasses manual review after verification.
  const inviteSecret = createSecureToken();
  await createPersonalInvite({
    email: "invited@example.com", tokenHash: inviteSecret.tokenHash,
    createdBy: owner.user_id, expiresAt: new Date(Date.now() + 86400000),
  });
  const invitedVerification = createSecureToken();
  const invited = await createRegistration(application({
    email: "invited@example.com", username: "invited", admissionMethod: "personal_invite",
    tokenHash: invitedVerification.tokenHash, sourceHash: inviteSecret.tokenHash,
  }));
  assert.equal(invited.account_status, "approved");
  const { rows: [invitedTokenCount] } = await db.query(
    "SELECT COUNT(*)::INT AS count FROM email_verification_tokens WHERE user_id = $1", [invited.user_id]
  );
  assert.equal(invitedTokenCount.count, 0);
  assert.equal((await hardDeleteTestUser(invited.user_id)).email, invited.email);
  const { rows: [remainingInvite] } = await db.query("SELECT COUNT(*)::INT AS count FROM personal_invites");
  assert.equal(remainingInvite.count, 0);

  // Flow 3: an active shared code behaves like the invite, and counts its use.
  const readableCode = "FACEBOOK-TEST";
  await createSharedCode({
    name: "Facebook test", codeHash: hashSecret(readableCode), createdBy: owner.user_id,
    expiresAt: new Date(Date.now() + 86400000), maxUses: 2,
  });
  const codeVerification = createSecureToken();
  await createRegistration(application({
    email: "coded@example.com", username: "coded", admissionMethod: "shared_code",
    tokenHash: codeVerification.tokenHash, sourceHash: hashSecret(readableCode),
  }));
  assert.equal((await verifyEmail(codeVerification.tokenHash)).account_status, "approved");
  const { rows: [code] } = await db.query("SELECT use_count FROM shared_invite_codes");
  assert.equal(code.use_count, 1);
  assert.equal((await hardDeleteTestUser((await db.query("SELECT user_id FROM users WHERE email = 'coded@example.com'")).rows[0].user_id)).email, "coded@example.com");
  const { rows: [restoredCode] } = await db.query("SELECT use_count FROM shared_invite_codes");
  assert.equal(restoredCode.use_count, 0);

  console.log("Registration integration test passed: all three flows and test-account hard deletion.");
} finally {
  await db.query("ROLLBACK");
  await db.end();
}
