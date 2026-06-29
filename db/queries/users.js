import db from "#db/client";
import bcrypt from "bcrypt";

export async function getUsers() {
  const sql = `
    SELECT * FROM users
  `;
  const { rows: users } = await db.query(sql);
  return users;
}

export async function createUser(email, username, password, role_id = 100) {
  username = username.toLowerCase();
  const sql = `
    INSERT INTO users (email, username, password, role_id)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  const hashedPassword = await bcrypt.hash(password, 10);
  const {
    rows: [user],
  } = await db.query(sql, [email, username, hashedPassword, role_id]);
  return user;
}
export async function updateUser(id, data){
  const sql = `
  UPDATE users
  SET 
    date_of_birth = $1,
    gender = $2,
    bio = $3,
    updated_at = NOW()
  WHERE user_id = $4
  RETURNING *;
  `;
  const {rows} = await db.query(sql, [data.date_of_birth || null, data.gender || null, data.bio || null, id]);
  return rows[0];
}

export async function updateLastSeen(userId) {
  const sql = `
    UPDATE users
    SET last_seen_at = NOW()
    WHERE user_id = $1
    RETURNING *;
  `;

  const { rows: [user] } = await db.query(sql, [userId]);
  return user;
}

export async function getUserByEmailAndPassword(email, password) {
  const sql = `
    SELECT * FROM users
    WHERE email = $1
  `;
  const {
    rows: [user],
  } = await db.query(sql, [email]);
  if (!user) return null;

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) return null;

  return user;
}

export async function getUserById(id) {
  const sql = `
    SELECT * FROM users
    WHERE user_id = $1
  `;
  const {
    rows: [user],
  } = await db.query(sql, [id]);
  return user;
}

export async function getUserByUserName(username) {
  const sql = `
  SELECT *
  FROM users
  WHERE username = $1
  `;
  const { rows: [user]} = await db.query(sql, [username]);
  return user;
}


export async function updateUserSteamId(userId, steamId) {
  const sql = `
    UPDATE users
    SET steam_id = $2
    WHERE user_id = $1
    RETURNING *;
  `;
  const {
    rows: [user],
  } = await db.query(sql, [userId, steamId]);
  return user;
}

// Added PSN Update Function
export async function updateUserPsnId(userId, psnId) {
  const sql = `
    UPDATE users
    SET psn_id = $2
    WHERE user_id = $1
    RETURNING *; -- Crucial: returns all columns, including steam_id
  `;
  const {
    rows: [user],
  } = await db.query(sql, [userId, psnId]);
  return user;
}


export async function updateUserXboxId(userId, xboxXuid, xboxGamertag){
  const sql = `
    UPDATE users
    SET xbox_xuid = $2,
    xbox_gamertag = $3
    WHERE user_id = $1
    RETURNING *;
  `;
  const { rows: [user] } = await db.query(sql, [userId, xboxXuid, xboxGamertag]);
  return user;
}


export async function updateUserBattleNet(userId, battleNetId, battleTag, region) {
  const {
    rows: [user],
  } = await db.query(
    `
    UPDATE users
    SET battle_net_id = $2,
        battle_tag = $3,
        battle_net_region = $4,
        battle_net_connected_at = NOW()
    WHERE user_id = $1
    RETURNING *
    `,
    [userId, battleNetId, battleTag, region]
  );

  return user;
}
