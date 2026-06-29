import db from "#db/client";

export async function createSessionReview({ session_id, user_id, session_rating, member_ratings }) {
  const sql = `
    INSERT INTO session_reviews (
      session_id,
      user_id,
      session_rating,
      member_ratings
    ) VALUES ($1, $2, $3, $4::jsonb)
    RETURNING *;
  `;

  const { rows: [review] } = await db.query(sql, [
    session_id,
    user_id,
    session_rating,
    JSON.stringify(member_ratings),
  ]);

  return review;
}

export async function getSessionReviewsBySessionId(session_id) {
  const sql = `
    SELECT *
    FROM session_reviews
    WHERE session_id = $1
    ORDER BY created_at DESC;
  `;
  const { rows } = await db.query(sql, [session_id]);
  return rows;
}

export async function updateSessionReviewById(sessionReviewId, userId, session_rating, member_ratings) {
  const sql = `
    UPDATE session_reviews
    SET session_rating = $1,
        member_ratings = $2::jsonb,
        updated_at = NOW()
    WHERE session_review_id = $3
      AND user_id = $4
    RETURNING *;
  `;

  const {
    rows: [updatedReview],
  } = await db.query(sql, [
    session_rating,
    JSON.stringify(member_ratings),
    sessionReviewId,
    userId,
  ]);

  return updatedReview;
}
