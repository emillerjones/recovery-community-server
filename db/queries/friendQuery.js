import db from "#db/client";

//--------------------Friend List Section ----------//

export async function getPendingFriendRequests(userId){
    //If user_id_1 is user_id, then user_id_2 is userId --get the id and name of other user
    //if user_id_2 is user_id then user_id_1 is userId  --get the id and name of other user
    //WHERE: get only rows where userId is sender or receiver and the status is pending.  
    const sql = `
    SELECT 
      f.*,
      u.username AS friend_username,
      u.user_id AS friend_id
    FROM friendships f
    JOIN users u ON u.user_id = 
        (
        CASE
            WHEN f.user_id_1 = $1 THEN f.user_id_2
            ELSE f.user_id_1
        END
        )
    WHERE (f.user_id_1 = $1 OR f.user_id_2 = $1)
    AND f.status = 'pending';
  `;
  const { rows } = await db.query(sql, [userId]);
  return rows;
}

export async function getFriendList(userId){
  const sql = `
    SELECT u.user_id, u.username 
    FROM friendships f
    JOIN users u ON u.user_id = (
      CASE
        WHEN f.user_id_1 = $1 THEN f.user_id_2
        ELSE f.user_id_1
      END
    )
    WHERE (f.user_id_1 = $1 OR f.user_id_2 = $1)
    AND f.status = 'accepted';
  `;
  const { rows } = await db.query(sql, [userId]);
  return rows;
}
//This creates a new relationship if one does not exist, however, if a relationship does
//already exist, then it UPDATES that relationship, and resets sender/receiver to most recent interaction
export async function sendFriendRequest(userId1, userId2, actorId){
  const sql = `
    INSERT INTO friendships (user_id_1, user_id_2, status, actor_id)
    VALUES ($1, $2, 'pending', $3)
    ON CONFLICT (user_id_1, user_id_2) 
    DO UPDATE SET
        user_id_1 = EXCLUDED.user_id_1,
        user_id_2 = EXCLUDED.user_id_2,
        status = 'pending'
    WHERE friendships.status = 'denied'
    RETURNING *;
  `;
  const { rows } = await db.query(sql, [userId1, userId2, actorId]);
  return rows[0];
}

export async function acceptFriendRequest(userId1, userId2, actorId){
  const sql = `
    UPDATE friendships
    SET 
      status = 'accepted',
      updated_at = NOW(),
      actor_id = $3
    WHERE 
      user_id_1 = $1 AND 
      user_id_2 = $2 AND
      STATUS = 'pending'
    RETURNING *;
  `;
  const { rows } = await db.query(sql, [userId1, userId2, actorId]);
  return rows[0];
}

export async function denyFriendRequest(userId1, userId2, actorId){
  const sql = `
    UPDATE friendships
    SET
        status = 'denied',
        updated_at = NOW(),
        actor_id = $3
    WHERE 
        user_id_1 = $1 AND
        user_id_2 = $2
    RETURNING *; 
  `;
  const { rows } = await db.query(sql, [userId1, userId2, actorId]);
  return rows[0];
}

export async function blockUser(userId1, userId2, actorId){
    const sql = `
    INSERT INTO friendships (user_id_1, user_id_2, status, actor_id)
    VALUES ($1, $2, 'blocked', $3)
    ON CONFLICT (user_id_1, user_id_2) 
    DO UPDATE SET
        status = 'blocked',
        actor_id = EXCLUDED.actor_id
    RETURNING *;
    `;
    const { rows } = await db.query(sql, [userId1, userId2, actorId]);
    return rows[0];
}
//Very similar to getpending and getfriends 
//Receiver = person to be blocked
//Sender = Person doing the blocking = userId
export async function getBlockList(userId) {
      const sql = `
    SELECT u.user_id, u.username 
    FROM friendships f
    JOIN users u ON u.user_id = (
      CASE
        WHEN f.user_id_2 = $1 THEN f.user_id_1
        ELSE f.user_id_2
      END
    )
    WHERE f.actor_id = $1 AND f.status = 'blocked'
    AND f.status = 'blocked';
  `;
  const { rows } = await db.query(sql, [userId]);
  return rows;    
}
//User removes another from their block list
export async function removeFromBlocklist(userId1, userId2, actorId) {
  const sql = `
    DELETE FROM friendships 
    WHERE user_id_2 = $2 AND user_id_1 = $1
    RETURNING *;
    `;
    const { rows } = await db.query(sql, [userId1, userId2]);
    return rows[0];
}