import db, { withTransaction } from "#db/client";

const CHECKIN_SELECT = `
  SELECT checkin.checkin_id, checkin.user_id, member.username, member.avatar_url,
         checkin.mood, checkin.note, checkin.open_to_support,
         checkin.checkin_date, checkin.created_at, checkin.updated_at,
         COUNT(support.user_id)::INT AS support_count,
         COALESCE(BOOL_OR(support.user_id = $1), FALSE) AS viewer_supported
  FROM community_checkins checkin
  JOIN users member ON member.user_id = checkin.user_id
  LEFT JOIN community_checkin_supports support ON support.checkin_id = checkin.checkin_id
  WHERE checkin.checkin_date = $2
    AND member.active = TRUE
    AND member.account_status = 'approved'
    AND member.deleted_at IS NULL
  GROUP BY checkin.checkin_id, member.username, member.avatar_url
`;

export async function getTodayGrove(viewerId, checkinDate) {
  const [checkinsResult, supportResult] = await Promise.all([
    db.query(`${CHECKIN_SELECT} ORDER BY checkin.updated_at DESC`, [viewerId, checkinDate]),
    db.query(
      `SELECT COUNT(*)::INT AS support_count
       FROM community_checkin_supports support
       JOIN community_checkins checkin ON checkin.checkin_id = support.checkin_id
       WHERE checkin.checkin_date = $1`,
      [checkinDate]
    ),
  ]);
  return {
    checkins: checkinsResult.rows,
    summary: {
      checkin_count: checkinsResult.rows.length,
      support_count: supportResult.rows[0].support_count,
    },
  };
}

export async function upsertTodayCheckin({ userId, checkinDate, mood, note, openToSupport }) {
  const { rows: [checkin] } = await db.query(
    `WITH saved AS (
       INSERT INTO community_checkins (user_id, checkin_date, mood, note, open_to_support)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, checkin_date) DO UPDATE
         SET mood = EXCLUDED.mood,
             note = EXCLUDED.note,
             open_to_support = EXCLUDED.open_to_support,
             updated_at = NOW()
       RETURNING *
     )
     SELECT saved.checkin_id, saved.user_id, member.username, member.avatar_url,
            saved.mood, saved.note, saved.open_to_support, saved.checkin_date,
            saved.created_at, saved.updated_at,
            (SELECT COUNT(*)::INT FROM community_checkin_supports support
             WHERE support.checkin_id = saved.checkin_id) AS support_count,
            FALSE AS viewer_supported
     FROM saved JOIN users member ON member.user_id = saved.user_id`,
    [userId, checkinDate, mood, note || null, openToSupport]
  );
  return checkin;
}

export async function toggleCheckinSupport({ checkinId, userId }) {
  return withTransaction(async (client) => {
    const { rows: [checkin] } = await client.query(
      `SELECT checkin_id, user_id FROM community_checkins
       WHERE checkin_id = $1
         AND checkin_date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 1
       FOR UPDATE`,
      [checkinId]
    );
    if (!checkin || checkin.user_id === userId) return null;

    const { rowCount } = await client.query(
      `DELETE FROM community_checkin_supports
       WHERE checkin_id = $1 AND user_id = $2`,
      [checkinId, userId]
    );
    const supported = rowCount === 0;
    if (supported) {
      await client.query(
        `INSERT INTO community_checkin_supports (checkin_id, user_id)
         VALUES ($1, $2)`,
        [checkinId, userId]
      );
    }
    const { rows: [result] } = await client.query(
      `SELECT COUNT(*)::INT AS support_count
       FROM community_checkin_supports WHERE checkin_id = $1`,
      [checkinId]
    );
    return { checkin_id: checkinId, supported, support_count: result.support_count };
  });
}
