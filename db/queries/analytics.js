import db from "#db/client";

export async function createAnalyticsEvent({
  userId = null,
  sessionId,
  eventType,
  pageKey = null,
  deviceType,
  countryCode = null,
  region = null,
}) {
  const { rows: [event] } = await db.query(
    `
      INSERT INTO analytics_events (
        user_id, session_id, event_type, page_key, device_type,
        country_code, region
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING event_id, created_at
    `,
    [userId, sessionId, eventType, pageKey, deviceType, countryCode, region]
  );
  return event;
}

export async function getAnalyticsSummary({ startAt, endAt }) {
  const range = [startAt, endAt];
  const [totalsResult, pagesResult, devicesResult, locationsResult] = await Promise.all([
    db.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE event_type = 'login')::INT AS logins,
          COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL)::INT AS unique_members,
          COUNT(*) FILTER (WHERE event_type = 'page_view')::INT AS page_views,
          COUNT(DISTINCT session_id) FILTER (WHERE user_id IS NULL)::INT AS anonymous_sessions
        FROM analytics_events
        WHERE created_at >= $1 AND created_at < $2
      `,
      range
    ),
    db.query(
      `
        SELECT page_key, COUNT(*)::INT AS views
        FROM analytics_events
        WHERE created_at >= $1 AND created_at < $2
          AND event_type = 'page_view'
        GROUP BY page_key
        ORDER BY views DESC, page_key
      `,
      range
    ),
    db.query(
      `
        SELECT device_type, COUNT(DISTINCT session_id)::INT AS sessions
        FROM analytics_events
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY device_type
        ORDER BY sessions DESC, device_type
      `,
      range
    ),
    db.query(
      `
        SELECT country_code, region, COUNT(DISTINCT session_id)::INT AS sessions
        FROM analytics_events
        WHERE created_at >= $1 AND created_at < $2
          AND country_code IS NOT NULL
        GROUP BY country_code, region
        ORDER BY sessions DESC, country_code, region
        LIMIT 20
      `,
      range
    ),
  ]);

  return {
    totals: totalsResult.rows[0],
    pages: pagesResult.rows,
    devices: devicesResult.rows,
    locations: locationsResult.rows,
  };
}

export async function getAnalyticsEvents({ startAt, endAt, eventType, beforeId, limit = 20 }) {
  const values = [startAt, endAt];
  const conditions = ["ae.created_at >= $1", "ae.created_at < $2"];

  if (eventType) {
    values.push(eventType);
    conditions.push(`ae.event_type = $${values.length}`);
  }
  if (beforeId) {
    values.push(beforeId);
    conditions.push(`ae.event_id < $${values.length}`);
  }
  values.push(limit + 1);

  const { rows } = await db.query(
    `
      SELECT
        ae.event_id, ae.user_id, u.username, ae.session_id,
        ae.event_type, ae.page_key, ae.device_type,
        ae.country_code, ae.region, ae.created_at
      FROM analytics_events ae
      LEFT JOIN users u ON u.user_id = ae.user_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY ae.event_id DESC
      LIMIT $${values.length}
    `,
    values
  );

  const hasMore = rows.length > limit;
  const events = hasMore ? rows.slice(0, limit) : rows;
  return {
    events,
    hasMore,
    nextCursor: hasMore ? events.at(-1).event_id : null,
  };
}
