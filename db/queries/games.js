import db from "#db/client";
import bcrypt from "bcrypt";



export async function getGames(){
  const sql = `
  SELECT *
  FROM games
  `;
  const { rows: games } = await db.query(sql);
  return games;
}

export async function getGamesForImageURL(){
  const sql = `
    SELECT *
    FROM games

  `;
  const { rows: games } = await db.query(sql);
  return games;
}

export async function getGameById(game_id) {
  const sql = `
    SELECT *
    FROM games
    WHERE game_id = $1
  `;

  const { rows } = await db.query(sql, [game_id]);
  return rows[0];
}


export async function updateGameImage(game_id, imageUrl) {
  const sql = `
    UPDATE games
    SET cover_image_url = $1
    WHERE game_id = $2
    RETURNING *;
  `;

  const { rows: [game] } = await db.query(sql, [imageUrl, game_id]);
  return game;
}

export const getUserFavoriteGames = async (userId) => {
  const sql = `
    SELECT g.* FROM games g
    JOIN user_favorite_games ufg ON g.game_id = ufg.game_id
    WHERE ufg.user_id = $1;
  `;
  const { rows } = await db.query(sql, [userId]);
  return rows;
};


export const addFavoriteGame = async (userId, gameId) => {
  const sql = `
    INSERT INTO user_favorite_games (user_id, game_id)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING;
  `;
  await db.query(sql, [userId, gameId]);
};

export async function checkFavorites(userId, game_id){
  const sql = `
    SELECT * FROM user_favorite_games 
     WHERE user_id = $1 AND game_id = $2;
  `;
  const { rows } = await db.query(sql, [userId, game_id]);
  return rows;
}

export async function removeFavorite(userId, game_id) {
  const sql = `
    DELETE FROM user_favorite_games 
    WHERE user_id = $1 AND game_id = $2
    RETURNING *;
  `;
  const {rows} = await db.query(sql, [userId, game_id]);
  return rows[0];
}