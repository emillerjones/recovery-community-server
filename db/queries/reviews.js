import db from '#db/client';

/* === Game Reviews === */

export async function createGameReviews(
    reviewTitle,
    gameReview,
    gameId,
    ratingValue,
    user_id
) {
    const sql = `
    INSERT INTO game_reviews (
        review_title,
        game_review,
        game_id,
        rating_value,
        user_id
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
    `;

    try {
        const { rows: [gameReviewRow] } = await db.query(
            sql,
            [
                reviewTitle,
                gameReview,
                gameId,
                ratingValue,
                user_id
            ]
        );
        return gameReviewRow;
    } catch (e) {
        console.error(e);
        throw new Error("Failed to post review.");
    }
};

export async function getGameReviews() {
    const sql = `
    SELECT
        game_reviews.*,
        games.game_title,
        games.cover_image_url,
        users.username,
        COALESCE(rv.score, 0) AS vote_score,
        COALESCE(rv.upvotes, 0) AS vote_upvotes,
        COALESCE(rv.downvotes, 0) AS vote_downvotes
    FROM game_reviews
    INNER JOIN games ON games.game_id = game_reviews.game_id
    INNER JOIN users ON users.user_id = game_reviews.user_id
    LEFT JOIN (
      SELECT
        game_review_id,
        SUM(vote_value) AS score,
        SUM(CASE WHEN vote_value = 1 THEN 1 ELSE 0 END) AS upvotes,
        SUM(CASE WHEN vote_value = -1 THEN 1 ELSE 0 END) AS downvotes
      FROM review_votes
      GROUP BY game_review_id
    ) rv ON rv.game_review_id = game_reviews.game_review_id
    `;
    const { rows: gameReviews } = await db.query(sql);
    return gameReviews;
}

export async function getGameReviewById(gameReviewId) {
    const sql = `
    SELECT
        game_reviews.*,
        games.game_title,
        games.cover_image_url,
        users.username
    FROM game_reviews
    INNER JOIN games ON games.game_id = game_reviews.game_id
    INNER JOIN users ON users.user_id = game_reviews.user_id
    WHERE game_review_id = $1
    `;
    const { rows: [gameReview] } = await db.query(sql, [gameReviewId]);
    return gameReview;
}

export async function getGameReviewByGameId(gameId) {
    const sql = `
    SELECT games.*
    FROM game_reviews
    JOIN games ON game_reviews.game_id = games.game_id
    WHERE games.game_id = $1
    `;
    const { rows: [game] } = await db.query(sql, [gameId]);
    return game;
};

export async function getMyReview(userId) {
    const sql = `
    SELECT *
    FROM game_reviews
    WHERE user_id = $1
    `;
    const { rows: myGameReviews } = await db.query(sql, [userId]);
    return myGameReviews;
};

export async function incrementGameReviewViewCount(id) {
  const {
    rows: [review],
  } = await db.query(
    `
    UPDATE game_reviews
    SET view_counter = view_counter + 1
    WHERE game_review_id = $1
    RETURNING *
    `,
    [id]
  );

  return review;
}

export async function deleteGameReviewById(gameReviewId, userId) {
  const sql = `
    DELETE FROM game_reviews
    WHERE game_review_id = $1
      AND user_id = $2
    RETURNING *
  `;

  const {
    rows: [deletedReview],
  } = await db.query(sql, [gameReviewId, userId]);

  return deletedReview;
}

export async function updateGameReviewById(gameReviewId, userId, reviewTitle, gameReview, ratingValue) {
  const sql = `
    UPDATE game_reviews
    SET review_title = $1, game_review = $2, rating_value = $3, updated_at = NOW()
    WHERE game_review_id = $4 AND user_id = $5
    RETURNING *
  `;

  const {
    rows: [updatedReview],
  } = await db.query(sql, [reviewTitle, gameReview, ratingValue, gameReviewId, userId]);

  return updatedReview;
}

// ===== Review Votes (thumbs up / thumbs down) =====
export async function getReviewVotes(gameReviewId, userId = null) {
  const votesSql = `
    SELECT
      SUM(vote_value) AS score,
      SUM(CASE WHEN vote_value = 1 THEN 1 ELSE 0 END) AS upvotes,
      SUM(CASE WHEN vote_value = -1 THEN 1 ELSE 0 END) AS downvotes
    FROM review_votes
    WHERE game_review_id = $1
  `;

  const { rows: [totals] } = await db.query(votesSql, [gameReviewId]);

  let userVote = null;
  if (userId) {
    const { rows } = await db.query(
      `SELECT vote_value FROM review_votes WHERE game_review_id = $1 AND user_id = $2`,
      [gameReviewId, userId]
    );
    if (rows.length) userVote = rows[0].vote_value;
  }

  return {
    score: Number(totals.score || 0),
    upvotes: Number(totals.upvotes || 0),
    downvotes: Number(totals.downvotes || 0),
    userVote,
  };
}

export async function upsertReviewVote(gameReviewId, userId, voteValue) {
  const sql = `
    INSERT INTO review_votes (game_review_id, user_id, vote_value)
    VALUES ($1, $2, $3)
    ON CONFLICT (game_review_id, user_id)
    DO UPDATE SET vote_value = EXCLUDED.vote_value, created_at = NOW()
    RETURNING *
  `;

  const { rows: [voteRow] } = await db.query(sql, [gameReviewId, userId, voteValue]);
  return voteRow;
}

export async function deleteReviewVote(gameReviewId, userId) {
  const sql = `
    DELETE FROM review_votes
    WHERE game_review_id = $1 AND user_id = $2
    RETURNING *
  `;

  const { rows: [deleted] } = await db.query(sql, [gameReviewId, userId]);
  return deleted;
}