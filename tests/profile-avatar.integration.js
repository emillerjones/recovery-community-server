import assert from "node:assert/strict";
import fs from "node:fs/promises";
import db from "#db/client";
import { attachProfileAvatar, getViewableMedia } from "#db/queries/media";
import { updateOwnProfile } from "#db/queries/users";

const schemaName = "codex_profile_avatar_integration";

await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await db.query(`CREATE SCHEMA ${schemaName}`);
  await db.query(`SET LOCAL search_path TO ${schemaName}`);
  await db.query(await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
  await db.query("INSERT INTO user_roles (role_id, role_name) VALUES (100, 'Member')");
  const { rows: [member] } = await db.query(
    `INSERT INTO users (role_id, email, password, username, account_status)
     VALUES (100, 'avatar@example.com', 'unused', 'avatar-member', 'pending') RETURNING *`
  );
  const { rows: media } = await db.query(
    `INSERT INTO media_assets (uploaded_by, provider_asset_id, format, byte_size, width, height)
     VALUES ($1, 'test/avatar-one', 'webp', 100, 512, 512),
            ($1, 'test/avatar-two', 'webp', 110, 512, 512)
     RETURNING *`,
    [member.user_id]
  );

  const first = await attachProfileAvatar(media[0].media_id, member.user_id);
  assert.equal(first.user.avatar_url, `media:${media[0].media_id}`);
  assert.equal(String(first.user.avatar_media_id), String(media[0].media_id));
  assert.ok(await getViewableMedia(media[0].media_id, member.user_id));

  const second = await attachProfileAvatar(media[1].media_id, member.user_id);
  assert.equal(second.retiredProviderAssetId, "test/avatar-one");
  const { rows: [retired] } = await db.query(
    "SELECT status FROM media_assets WHERE media_id = $1",
    [media[0].media_id]
  );
  assert.equal(retired.status, "deleted");

  const preset = await updateOwnProfile(member.user_id, {
    bio: "", phoneNumber: "", dateOfBirth: "", gender: "", avatarUrl: "preset:Butterfly:forest",
  });
  assert.equal(preset.avatar_media_id, null);
  assert.equal(preset.avatar_url, "preset:Butterfly:forest");
  assert.equal(preset.retired_avatar_provider_id, "test/avatar-two");

  console.log("PROFILE_AVATAR_INTEGRATION_OK attach=protected replace=retired preset=cleanup");
} finally {
  await db.query("ROLLBACK").catch(() => {});
  await db.end();
}
