import db, { withTransaction } from '#db/client';
import { DEFAULT_THRESHOLDS } from '#utils/loungeModerationConfig';

export async function changeModerationThreshold({ category, value, revision, userId }) {
  return withTransaction(async client=>{
    const {rows:[settings]}=await client.query('SELECT thresholds,threshold_revision FROM moderation_settings WHERE settings_id=1 FOR UPDATE');
    if(!settings||settings.threshold_revision!==revision)return null;
    const previous=settings.thresholds[category]??DEFAULT_THRESHOLDS[category];
    if(previous===value)return {changed:false};
    await client.query(`UPDATE moderation_settings SET thresholds=jsonb_set(thresholds,ARRAY[$1]::TEXT[],$2::jsonb),
      threshold_revision=threshold_revision+1,thresholds_updated_at=NOW(),thresholds_updated_by=$3 WHERE settings_id=1`,[category,JSON.stringify(value),userId]);
    await client.query(`INSERT INTO moderation_threshold_changes(category,previous_threshold,threshold,revision,changed_by)
      VALUES($1,$2,$3,$4,$5)`,[category,previous,value,revision+1,userId]);
    return {changed:true};
  });
}

export async function thresholdHistory() {
  return (await db.query(`SELECT c.change_id,c.category,c.previous_threshold,c.threshold,c.revision,c.created_at,u.username changed_by_username
    FROM moderation_threshold_changes c LEFT JOIN users u ON u.user_id=c.changed_by ORDER BY c.revision DESC LIMIT 30`)).rows;
}
