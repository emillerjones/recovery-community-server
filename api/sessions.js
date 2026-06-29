import express from "express";
const router = express.Router();
export default router;

import db from "#db/client"; 
import { createTemporaryVoiceChannel } from "#utils/discordBot";
import { 
  getSessions, 
  createSession, 
  addUserToSession, 
  getSessionsByUserId,
  deleteSession,
  removeUserFromSession,
  updateSession,
  getSessionById 
} from "#db/queries/sessions";

import { 
  createNotification, 
  getMyNotifications,
  markNotificationAsRead
   
} from "#db/queries/notifications";


import requireBody from "#middleware/requireBody";
import requireUser from "#middleware/requireUser";

// 1. GET all sessions
router.get("/", async (req, res) => {
  try {
    const sql = `
      SELECT 
        sessions.session_id, 
        sessions.game_id, 
        sessions.host_user_id, 
        sessions.session_title, 
        sessions.session_description, 
        sessions.max_users, 
        sessions.session_status, 
        sessions.is_private, 
        sessions.matchmaking_enabled, 
        sessions.playstyle, 
        sessions.created_at, 
        sessions.updated_at,
        games.game_title,
        games.cover_image_url,
        users.username AS host_username, -- ✅ CRITICAL: Fetches the host's real name!
        COUNT(session_users.user_id)::INTEGER as current_user_count
      FROM sessions
      JOIN games ON sessions.game_id = games.game_id
      JOIN users ON sessions.host_user_id = users.user_id -- ✅ CRITICAL: Joins the user profiles!
      LEFT JOIN session_users ON sessions.session_id = session_users.session_id
      GROUP BY 
        sessions.session_id, 
        games.game_title, 
        games.cover_image_url, 
        users.username;
    `;
    const { rows: sessions } = await db.query(sql);
    res.send(sessions);
  } catch (err) {
    console.error("❌ Sessions route breakdown:", err.message);
    res.status(500).send("Error fetching sessions catalog");
  }
});

// 2. GET My Active Sessions
router.get("/user/me", requireUser, async (req, res) => {
  try {
    const sessions = await getSessionsByUserId(req.user.user_id);
    res.send(sessions);
  } catch (err) {
    res.status(500).send("Error fetching your sessions");
  }
});

// 3. GET Session Details
router.get("/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sql = `
      SELECT sessions.*, games.game_title, games.cover_image_url 
      FROM sessions 
      JOIN games ON sessions.game_id = games.game_id 
      WHERE sessions.session_id = $1;
    `;
    const { rows: [session] } = await db.query(sql, [sessionId]);
    if (!session) return res.status(404).send("Session not found");
    
    res.send(session);
  } catch (err) {
    res.status(500).send("Error fetching session details");
  }
});

// 4. GET Session Users
router.get("/:sessionId/users", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sql = `
      SELECT session_users.membership_status, session_users.is_host, 
             users.user_id, users.username, users.avatar_url, users.xbox_gamertag
      FROM session_users 
      JOIN users ON session_users.user_id = users.user_id 
      WHERE session_users.session_id = $1;
    `;
    const { rows } = await db.query(sql, [sessionId]);
    res.send(rows);
  } catch (err) {
    res.send([]);
  }
});

// 5. POST Create Session (Fully Fixed Invite URL Concatenation)
router.post("/", requireUser, requireBody(["game_id", "session_title"]), async (req, res) => {
  try {
    // 1. Trigger your upgraded voice channel generator script
    const discordRoom = await createTemporaryVoiceChannel(req.body.session_title);
    
    const rawDescription = req.body.session_description || "No description provided.";
    
    // 2. FIXED: Links the live ticket url variable string explicitly behind your marker tag
    const automatedDescription = discordRoom 
      ? `${rawDescription}\n\n[DISCORD_LINK]:${discordRoom.voice_url}` 
      : rawDescription;
    
    const session = await createSession({ 
      ...req.body, 
      session_description: automatedDescription, 
      host_user_id: req.user.user_id 
    });
    
    await addUserToSession(session.session_id, req.user.user_id);
    res.status(201).send(session);
  } catch (err) {
    console.error("❌ Session creation error:", err.message);
    res.status(500).send("Error creating session");
  }
});

// 6. POST Join Session
router.post("/:sessionId/join", requireUser, async (req, res) => {
  try {
    const sessionUser = await addUserToSession(req.params.sessionId, req.user.user_id);
    res.status(201).send(sessionUser);
  } catch (err) {
    if (err.code === "23505") return res.status(400).send("Already in session");
    res.status(500).send("Error joining session");
  }
});


// 6.5 EMJ - Add user to session from dropdown
router.post("/:sessionId/addUser", requireUser, async (req, res) => {
  try {
    const sessionUser = await addUserToSession(
      req.params.sessionId,
      req.body.user_id
    );


  const session = await getSessionById(req.params.sessionId);
  try {
    await createNotification(
      req.body.user_id,
      3,
      `${req.user.username} invited you to a session: ${session.session_title}`
    );
  } catch (notificationErr) {
    console.error("Notification failed:", notificationErr);
  }

    res.status(201).send(sessionUser);
  } catch (err) {
    if (err.code === "23505") return res.status(400).send("user Already in session");
    res.status(500).send("Error adding user to session");
  }
});




// 7. DELETE Close Session (Fully Merged & Upgraded String RegEx Extraction Module)
router.delete("/:sessionId", requireUser, async (req, res) => {
  try {
    const { sessionId } = req.params;

    // 1. Fetch the full session profile first to extract description strings before database wipe
    const sessionDetailsSql = `SELECT * FROM sessions WHERE session_id = $1;`;
    const { rows: [session] } = await db.query(sessionDetailsSql, [sessionId]);
    if (!session) return res.status(404).send("Session not found");

    if (Number(session.host_user_id) !== Number(req.user.user_id)) {
      return res.status(403).send("Only the lobby host can close this session");
    }

    // 2. UPGRADED DISCORD BOT CLEANUP MODULE: Direct universal text string string link finder
    if (session.session_description && session.session_description.includes("https://discord.gg")) {
      try {
        const { deleteTemporaryVoiceChannel } = await import("#utils/discordBot");

        // Alphanumeric split matcher finds the exact channel code string regardless of layout space padding
        const channelIdMatch = session.session_description.match(/[a-zA-Z0-9]+$/);

        if (channelIdMatch) {
          const pureChannelId = channelIdMatch[0]; // Extracts the clean channel ID
          await deleteTemporaryVoiceChannel(pureChannelId); // Signals the bot to drop the room channel layout
        }
      } catch (botErr) {
        console.error("Discord API room sweep bypassed:", botErr.message);
      }
    }

    // 3. Clear your Postgres application keys cleanly
    await db.query("DELETE FROM session_messages WHERE session_id = $1;", [sessionId]);
    await db.query("DELETE FROM session_users WHERE session_id = $1;", [sessionId]);

    await deleteSession(sessionId);
    res.send({ message: "Session and companion voice channel successfully closed" });
  } catch (err) {
    res.status(500).send("Error deleting session and cleaning up channels");
  }
});

// 7b. NEW HOST KICK USER MODULE (Merged directly under Close Session endpoint)
router.delete("/:sessionId/kick/:targetUserId", requireUser, async (req, res) => {
  try {
    const { sessionId, targetUserId } = req.params;
    const currentUserId = req.user.user_id;

    // Verify the incoming request operator is the authentic host of the lobby target row
    const hostVerifySql = `SELECT host_user_id FROM sessions WHERE session_id = $1;`;
    const { rows: [session] } = await db.query(hostVerifySql, [sessionId]);
    
    if (!session) return res.status(404).send("Session lobby row entry not found");
    if (Number(session.host_user_id) !== Number(currentUserId)) {
      return res.status(403).send("Unauthorized: Only the lobby host can execute player kicks.");
    }

    // Safely removes the player row connection via your existing schema junction functions
    await removeUserFromSession(sessionId, targetUserId);
    
    res.send({ message: "Teammate successfully kicked from your active gaming squad layout." });
  } catch (err) {
    console.error("Host kick routing execution error:", err.message);
    res.status(500).send("Error executing player kick from session table registry.");
  }
});

// 8. DELETE Leave Session
router.delete("/:sessionId/leave", requireUser, async (req, res) => {
  try {
    const removed = await removeUserFromSession(req.params.sessionId, req.user.user_id);
    if (!removed) return res.status(404).send("You are not in this session");
    res.send({ message: "Successfully left the session" });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error leaving session");
  }
});

// 9. PUT Lobby settings configuration (Saves active toggle overrides)
router.put("/:sessionId/settings", requireUser, requireBody(["max_users", "session_status"]), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { max_users, session_status, matchmaking_enabled } = req.body;
    
    const session = await db.query(`SELECT host_user_id, session_title, session_description FROM sessions WHERE session_id = $1`, [sessionId]);
    const currentSession = session.rows[0];
    
    if (!currentSession) return res.status(404).send("Session not found");
    if (Number(currentSession.host_user_id) !== Number(req.user.user_id)) {
      return res.status(403).send("Only the lobby host can modify settings");
    }

    const updated = await updateSession(sessionId, {
      session_title: currentSession.session_title,
      session_description: currentSession.session_description,
      max_users: Number(max_users) || 4,
      session_status: session_status,
      matchmaking_enabled: matchmaking_enabled ?? false
    });
    res.send(updated);
  } catch (err) {
    res.status(500).send("Error updating lobby settings");
  }
});

// Global memory state map to track player ready-status lists out of DB bounds
const localReadyChecks = new Map();

// 9A. PUT /api/sessions/:sessionId/ready
router.put("/:sessionId/ready", requireUser, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = Number(req.user.user_id);

    if (!localReadyChecks.has(sessionId)) {
      localReadyChecks.set(sessionId, new Set());
    }

    const readySet = localReadyChecks.get(sessionId);
    if (readySet.has(userId)) { readySet.delete(userId); } else { readySet.add(userId); }
    res.send({ readyUserIds: Array.from(readySet) });
  } catch (err) {
    res.status(500).send("Error tracking localized ready state");
  }
});

// 9B. PUT /api/sessions/:sessionId/ready-reset
router.put("/:sessionId/ready-reset", requireUser, async (req, res) => {
  try {
    localReadyChecks.delete(req.params.sessionId);
    res.send({ message: "Ready checklist flushed cleanly" });
  } catch (err) {
    res.status(500).send("Error clearing local ready checklist");
  }
});

// 9C. GET /api/sessions/:sessionId/ready-list
router.get("/:sessionId/ready-list", async (req, res) => {
  const readySet = localReadyChecks.get(req.params.sessionId) || new Set();
  res.send({ readyUserIds: Array.from(readySet) });
});
// 10. POST /api/sessions/matchmaking/auto-fill (AUTOMATED MATCHMAKING ENGINE)
router.post("/matchmaking/auto-fill", requireUser, async (req, res) => {
  try {
    const userId = req.user.user_id;

    // Scans for public, active, unlocked lobbies with matchmaking_enabled = true
    const sql = `
      SELECT 
        sessions.session_id,
        sessions.max_users,
        COUNT(session_users.user_id)::INTEGER as current_user_count
      FROM sessions
      LEFT JOIN session_users ON sessions.session_id = session_users.session_id
      WHERE sessions.is_private = false 
        AND sessions.session_status = 'active'
        AND sessions.matchmaking_enabled = true
      GROUP BY sessions.session_id, sessions.max_users
      HAVING COUNT(session_users.user_id)::INTEGER < sessions.max_users
      ORDER BY sessions.created_at ASC
      LIMIT 1;
    `;
    
    const { rows: [matchedSession] } = await db.query(sql);

    if (!matchedSession) {
      return res.status(404).send("No open matchmaking queues found. Try hosting a lobby with intake enabled!");
    }

    const checkSql = `SELECT 1 FROM session_users WHERE session_id = $1 AND user_id = $2;`;
    const { rows: matchCheck } = await db.query(checkSql, [matchedSession.session_id, userId]);

    if (matchCheck.length === 0) {
      await addUserToSession(matchedSession.session_id, userId);
    }

    res.send({ session_id: matchedSession.session_id });
  } catch (err) {
    console.error("Matchmaking Engine Fail:", err.message);
    res.status(500).send("Matchmaking server encountered an issue");
  }
});



// 9A. PUT /api/sessions/:sessionId/ready
// router.put("/:sessionId/ready", requireUser, async (req, res) => {
//   try {
//     const { sessionId } = req.params;
//     const userId = Number(req.user.user_id);

//     if (!localReadyChecks.has(sessionId)) {
//       localReadyChecks.set(sessionId, new Set());
//     }

//     const readySet = localReadyChecks.get(sessionId);
//     if (readySet.has(userId)) { readySet.delete(userId); } else { readySet.add(userId); }
//     res.send({ readyUserIds: Array.from(readySet) });
//   } catch (err) {
//     res.status(500).send("Error tracking localized ready state");
//   }
// });

// 9B. PUT /api/sessions/:sessionId/ready-reset
// router.put("/:sessionId/ready-reset", requireUser, async (req, res) => {
//   try {
//     localReadyChecks.delete(req.params.sessionId);
//     res.send({ message: "Ready checklist flushed cleanly" });
//   } catch (err) {
//     res.status(500).send("Error clearing local ready checklist");
//   }
// });

// // 9C. GET /api/sessions/:sessionId/ready-list
// router.get("/:sessionId/ready-list", async (req, res) => {
//   const readySet = localReadyChecks.get(req.params.sessionId) || new Set();
//   res.send({ readyUserIds: Array.from(readySet) });
// });