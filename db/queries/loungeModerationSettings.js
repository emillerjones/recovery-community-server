import db, { withTransaction } from '#db/client';

export async function getModerationSettings() {
  const {rows:[settings]}=await db.query(`SELECT s.*,u.username updated_by_username,tu.username thresholds_updated_by_username
    FROM moderation_settings s LEFT JOIN users u ON u.user_id=s.updated_by
    LEFT JOIN users tu ON tu.user_id=s.thresholds_updated_by WHERE settings_id=1`);
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
