import db, { withTransaction } from '#db/client';

export async function getModerationSettings() {
  const {rows:[settings]}=await db.query(`SELECT s.*,u.username updated_by_username,tu.username thresholds_updated_by_username,mu.username review_mode_updated_by_username
    FROM moderation_settings s LEFT JOIN users u ON u.user_id=s.updated_by
    LEFT JOIN users tu ON tu.user_id=s.thresholds_updated_by
    LEFT JOIN users mu ON mu.user_id=s.review_mode_updated_by WHERE settings_id=1`);
  if(!settings)throw new Error('Lounge moderation settings unavailable');
  return settings;
}

export async function changeModerationSettings({ enabled, revision, userId }) {
  return withTransaction(async client=>{
    const {rows:[current]}=await client.query('SELECT * FROM moderation_settings WHERE settings_id=1 FOR UPDATE');
    if(!current||current.revision!==revision)return null;
    if(current.enabled===enabled)return current;
    await client.query(`UPDATE moderation_settings SET enabled=$1,revision=revision+1,updated_at=NOW(),updated_by=$2 WHERE settings_id=1`,[enabled,userId]);
    await client.query(`INSERT INTO moderation_setting_changes(previous_enabled,enabled,revision,changed_by)
      VALUES($1,$2,$3,$4)`,[current.enabled,enabled,current.revision+1,userId]);
    // Read through the reserved connection so uncommitted state is visible.
    return (await client.query(`SELECT s.enabled,s.revision,s.updated_at,s.updated_by,u.username updated_by_username
      FROM moderation_settings s LEFT JOIN users u ON u.user_id=s.updated_by WHERE settings_id=1`)).rows[0];
  });
}

export async function moderationSettingHistory() {
  return (await db.query(`SELECT c.change_id,c.previous_enabled,c.enabled,c.revision,c.created_at,u.username changed_by_username
    FROM moderation_setting_changes c LEFT JOIN users u ON u.user_id=c.changed_by
    ORDER BY c.revision DESC LIMIT 20`)).rows;
}

export async function changeReviewMode({reviewMode,revision,userId}) {
  return withTransaction(async client=>{
    const {rows:[current]}=await client.query('SELECT * FROM moderation_settings WHERE settings_id=1 FOR UPDATE');
    if(!current||current.review_mode_revision!==revision)return null;
    if(current.review_mode===reviewMode)return {changed:false};
    await client.query(`UPDATE moderation_settings SET review_mode=$1,review_mode_revision=review_mode_revision+1,
      review_mode_updated_at=NOW(),review_mode_updated_by=$2 WHERE settings_id=1`,[reviewMode,userId]);
    await client.query(`INSERT INTO moderation_mode_changes(previous_mode,review_mode,revision,changed_by)
      VALUES($1,$2,$3,$4)`,[current.review_mode,reviewMode,revision+1,userId]);
    return {changed:true};
  });
}

export async function reviewModeHistory() {
  return (await db.query(`SELECT c.*,u.username changed_by_username FROM moderation_mode_changes c
    LEFT JOIN users u ON u.user_id=c.changed_by ORDER BY c.revision DESC LIMIT 20`)).rows;
}
