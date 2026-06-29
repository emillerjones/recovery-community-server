import express from "express";
const router = express.Router();
export default router;

import { 
  getSessionMessages, 
  createSessionMessage, 
  deleteSessionMessage 
} from "#db/queries/sessionmessages";
import requireBody from "#middleware/requireBody";
import requireUser from "#middleware/requireUser"; // Added

/** GET /api/sessionmessages/:sessionId */
router.get("/:sessionId", async (req, res) => {
  try {
    const sessionMessages = await getSessionMessages(req.params.sessionId);
    // Return empty array instead of 404 so the frontend doesn't crash on new lobbies
    res.send(sessionMessages || []);
  } catch (err) {
    res.status(500).send("Error fetching messages");
  }
});

// Added requireUser so we can safely access req.user.user_id
router.post("/", requireUser, requireBody(["session_id", "message_text"]), async (req, res, next) => {
  try {
    const { session_id, message_text } = req.body;
    const user_id = req.user.user_id; 

    const message = await createSessionMessage(
      session_id,
      user_id,
      message_text
    );

    // Spread the user's name back so the chat UI shows it immediately
    res.status(201).send({ ...message, username: req.user.username });
  } catch (err) {
    next(err);
  }
});
