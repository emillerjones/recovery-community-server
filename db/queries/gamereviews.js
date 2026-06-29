import db from "#db/client";
import bcrypt from "bcrypt";



export async function getGameReviews(){
  const sql = `
  SELECT 
    game_reviews.*
    ,games.*
    ,users.username
  FROM 
    game_reviews
  INNER JOIN games ON games.game_id = game_reviews.game_id
  INNER JOIN users ON users.user_id = game_reviews.user_id
  `;
  const { rows: gameReviews } = await db.query(sql);
  return gameReviews;
}


export async function getGameReviewByID(game_review_id){
  const sql = `
  SELECT 
    game_reviews.*
    ,games.*
    ,users.username
  FROM 
    game_reviews
  INNER JOIN games ON games.game_id = game_reviews.game_id
  INNER JOIN users ON users.user_id = game_reviews.user_id
  WHERE game_review_id = $1
  
  `;
  const { rows } = await db.query(sql, [game_review_id]);
  return rows[0];
}


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