import db, { withTransaction } from '#db/client';
import { randomUUID } from 'node:crypto';

const eligible = `lr.slug='community-lounge' AND lr.access_level='members' AND lr.active=TRUE AND lm.deleted_at IS NULL`;

export async function reconcileJobs() {
  await db.query(`INSERT INTO moderation_jobs(message_id,content_version)
    SELECT lm.message_id,lm.moderation_revision FROM lounge_messages lm
    JOIN lounge_rooms lr ON lr.room_id=lm.room_id WHERE ${eligible}
      AND lm.moderation_revision>0 AND lm.moderation_changed_at>NOW()-INTERVAL '90 days'
      AND NOT EXISTS(SELECT 1 FROM moderation_jobs j WHERE j.message_id=lm.message_id AND j.content_version=lm.moderation_revision)
    ORDER BY lm.message_id LIMIT 100 ON CONFLICT DO NOTHING`);
  await db.query(`UPDATE moderation_jobs SET status='failed', claim_token=NULL, claimed_until=NULL,
    last_error='Retry limit reached after an interrupted attempt.'
    WHERE status='processing' AND claimed_until<NOW() AND attempt_count>=5`);
}

export async function claimJob() {
  const token = randomUUID();
  const { rows } = await db.query(`WITH candidate AS (
    SELECT job_id FROM moderation_jobs WHERE attempt_count<5 AND created_at>NOW()-INTERVAL '90 days'
      AND ((status='pending' AND next_attempt_at<=NOW()) OR (status='processing' AND claimed_until<NOW()))
    ORDER BY next_attempt_at,job_id LIMIT 1 FOR UPDATE SKIP LOCKED
  ) UPDATE moderation_jobs j SET status='processing',attempt_count=attempt_count+1,
    claim_token=$1,claimed_until=NOW()+INTERVAL '2 minutes',started_at=NOW()
    FROM candidate WHERE j.job_id=candidate.job_id RETURNING j.*`, [token]);
  return rows[0];
}

export async function getJobMessage(job) {
  const { rows } = await db.query(`SELECT lm.body FROM lounge_messages lm JOIN lounge_rooms lr ON lr.room_id=lm.room_id
    WHERE lm.message_id=$1 AND lm.moderation_revision=$2 AND ${eligible}`, [job.message_id, job.content_version]);
  return rows[0];
}

export async function completeJob(job, response, thresholds, triggered) {
  return withTransaction(async client => {
    // Hold the content lock through final version validation and result insertion.
    const { rows: [message] } = await client.query(`SELECT lm.* FROM lounge_messages lm JOIN lounge_rooms lr ON lr.room_id=lm.room_id
      WHERE lm.message_id=$1 AND ${eligible} FOR UPDATE OF lm`, [job.message_id]);
    const current = message && message.moderation_revision === job.content_version;
    const { rowCount } = await client.query(`UPDATE moderation_jobs SET status=$3, completed_at=NOW(),claim_token=NULL,claimed_until=NULL,last_error=NULL
      WHERE job_id=$1 AND claim_token=$2 AND status='processing' AND claimed_until>NOW()`, [job.job_id,job.claim_token,current?'completed':'superseded']);
    if (!rowCount || !current) return false;
    await client.query(`UPDATE moderation_results SET review_status='superseded' WHERE message_id=$1 AND review_status='pending' AND content_version<>$2`, [job.message_id,job.content_version]);
    await client.query(`INSERT INTO moderation_results(job_id,message_id,content_version,content_snapshot,model,response,thresholds_used,triggered_categories,needs_review,review_status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(job_id) DO NOTHING`,
    [job.job_id,job.message_id,job.content_version,message.body,response.model,JSON.stringify(response),JSON.stringify(thresholds),JSON.stringify(triggered),triggered.length>0,triggered.length?'pending':'not_needed']);
    return true;
  });
}

export async function supersedeJob(job) {
  await db.query(`UPDATE moderation_jobs SET status='superseded',completed_at=NOW(),claim_token=NULL,claimed_until=NULL
    WHERE job_id=$1 AND claim_token=$2 AND status='processing'`, [job.job_id,job.claim_token]);
}

export async function failJob(job, code) {
  // Store only a controlled code, not API response text, credentials, or member text.
  await db.query(`UPDATE moderation_jobs SET status=CASE WHEN attempt_count>=5 THEN 'failed' ELSE 'pending' END,
    next_attempt_at=NOW()+($3*INTERVAL '1 second'),last_error=$4,claim_token=NULL,claimed_until=NULL
    WHERE job_id=$1 AND claim_token=$2 AND status='processing'`,
  [job.job_id,job.claim_token,Math.min(3600,30*2**(job.attempt_count-1)),code]);
}

export async function purgeModerationData() {
  // Called even while API checks are disabled. Original Lounge retention is unchanged.
  await db.query(`UPDATE moderation_results SET content_snapshot=NULL,response=NULL,thresholds_used=NULL,
    triggered_categories='[]',purged_at=NOW(),review_status=CASE WHEN review_status='pending' THEN 'expired' ELSE review_status END
    WHERE checked_at<=NOW()-INTERVAL '90 days' AND purged_at IS NULL`);
  await db.query(`UPDATE moderation_jobs SET status='superseded',claim_token=NULL,claimed_until=NULL,last_error=NULL
    WHERE created_at<=NOW()-INTERVAL '90 days' AND status IN ('pending','processing','failed')`);
}

const currentResult = `${eligible} AND r.content_version=lm.moderation_revision AND r.purged_at IS NULL AND r.checked_at>NOW()-INTERVAL '90 days'`;
export async function getReviewQueue({ status='pending', page=1, search='' }) {
  const reviewed = status === 'reviewed';
  const filter = `FROM moderation_results r JOIN lounge_messages lm ON lm.message_id=r.message_id
    JOIN lounge_rooms lr ON lr.room_id=lm.room_id LEFT JOIN users u ON u.user_id=lm.author_id
    WHERE ${currentResult} AND r.review_status ${reviewed ? "IN ('cleared','deleted')" : "= 'pending'"}
    AND ($1='' OR strpos(lower(COALESCE(r.content_snapshot,'')),lower($1))>0 OR strpos(lower(COALESCE(u.username,lm.author_username)),lower($1))>0)`;
  // Deleted messages remain available to staff in reviewed history until expiry.
  const historyFilter = reviewed ? filter.replace('AND lm.deleted_at IS NULL','') : filter;
  const { rows } = await db.query(`SELECT r.*,lm.author_id,COALESCE(u.username,lm.author_username) author_username,u.avatar_url,lm.created_at message_created_at,lm.deleted_at,
    (SELECT COALESCE(json_agg(json_build_object('action',a.action,'created_at',a.created_at,'reviewer_username',ru.username) ORDER BY a.created_at),'[]'::json)
      FROM moderation_review_actions a LEFT JOIN users ru ON ru.user_id=a.reviewer_id WHERE a.result_id=r.result_id) actions
    ${historyFilter} ORDER BY r.checked_at DESC,r.result_id DESC LIMIT 20 OFFSET $2`, [search,(page-1)*20]);
  const { rows: [count] } = await db.query(`SELECT COUNT(*)::INT total ${historyFilter}`, [search]);
  const { rows: [counts] } = await db.query(`SELECT
    (SELECT COUNT(*)::INT FROM moderation_results r JOIN lounge_messages lm ON lm.message_id=r.message_id
      JOIN lounge_rooms lr ON lr.room_id=lm.room_id WHERE ${currentResult} AND r.review_status='pending') pending,
    (SELECT COUNT(*)::INT FROM moderation_jobs j JOIN lounge_messages lm ON lm.message_id=j.message_id JOIN lounge_rooms lr ON lr.room_id=lm.room_id
      WHERE ${eligible} AND j.content_version=lm.moderation_revision AND j.status='failed' AND j.created_at>NOW()-INTERVAL '90 days') failed,
    (SELECT COUNT(*)::INT FROM moderation_jobs WHERE status IN ('pending','processing') AND created_at>NOW()-INTERVAL '90 days') queued`);
  return { items:rows,total:count.total,page,hasMore:page*20<count.total,...counts };
}

export async function reviewResult({ resultId, userId, action }) {
  return withTransaction(async client => {
    const { rows: [target] } = await client.query('SELECT message_id FROM moderation_results WHERE result_id=$1',[resultId]);
    if (!target) return null;
    const { rows: [message] } = await client.query(`SELECT lm.* FROM lounge_messages lm JOIN lounge_rooms lr ON lr.room_id=lm.room_id
      WHERE lm.message_id=$1 AND ${eligible} FOR UPDATE OF lm`,[target.message_id]);
    const { rows: [result] } = await client.query(`SELECT * FROM moderation_results WHERE result_id=$1 AND review_status='pending'
      AND purged_at IS NULL AND checked_at>NOW()-INTERVAL '90 days' FOR UPDATE`,[resultId]);
    if (!message || !result || result.content_version!==message.moderation_revision) return null;
    let deleted = null;
    if (action==='delete') {
      deleted = (await client.query(`UPDATE lounge_messages SET deleted_at=NOW(),deleted_by=$2 WHERE message_id=$1 RETURNING message_id,deleted_at`,[message.message_id,userId])).rows[0];
    }
    await client.query(`UPDATE moderation_results SET review_status=$2,reviewed_by=$3,reviewed_at=NOW() WHERE result_id=$1`,[resultId,action==='delete'?'deleted':'cleared',userId]);
    await client.query(`INSERT INTO moderation_review_actions(result_id,reviewer_id,action) VALUES($1,$2,$3)`,[resultId,userId,action]);
    return { reviewed:true,deleted };
  });
}

export async function failedJobs() {
  return (await db.query(`SELECT j.job_id,j.message_id,j.attempt_count,j.last_error,j.started_at
    FROM moderation_jobs j JOIN lounge_messages lm ON lm.message_id=j.message_id JOIN lounge_rooms lr ON lr.room_id=lm.room_id
    WHERE ${eligible} AND j.status='failed' AND j.content_version=lm.moderation_revision
      AND j.created_at>NOW()-INTERVAL '90 days' ORDER BY j.job_id DESC LIMIT 50`)).rows;
}
export async function retryFailedJob(jobId) {
  return (await db.query(`UPDATE moderation_jobs j SET status='pending',attempt_count=0,next_attempt_at=NOW(),last_error=NULL
    FROM lounge_messages lm JOIN lounge_rooms lr ON lr.room_id=lm.room_id
    WHERE j.job_id=$1 AND j.message_id=lm.message_id AND ${eligible} AND j.status='failed'
      AND j.content_version=lm.moderation_revision AND j.created_at>NOW()-INTERVAL '90 days' RETURNING j.job_id`,[jobId])).rows[0];
}

export async function messageContext(messageId) {
  const target = (await db.query(`SELECT lm.message_id,lm.room_id FROM lounge_messages lm JOIN lounge_rooms lr ON lr.room_id=lm.room_id
    WHERE lm.message_id=$1 AND lr.slug='community-lounge' AND lr.access_level='members' AND lr.active=TRUE`,[messageId])).rows[0];
  if (!target) return null;
  return (await db.query(`SELECT context.message_id,context.author_id,COALESCE(u.username,context.author_username) author_username,
    u.avatar_url,CASE WHEN context.deleted_at IS NULL THEN context.body ELSE NULL END body,context.created_at,context.deleted_at FROM (
    (SELECT * FROM lounge_messages WHERE room_id=$2 AND message_id<=$1 ORDER BY message_id DESC LIMIT 11)
    UNION ALL (SELECT * FROM lounge_messages WHERE room_id=$2 AND message_id>$1 ORDER BY message_id LIMIT 10)
    ) context LEFT JOIN users u ON u.user_id=context.author_id ORDER BY context.message_id`,[messageId,target.room_id])).rows;
}
