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
