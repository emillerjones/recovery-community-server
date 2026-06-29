import express from "express";
const router = express.Router();
//export default router; - emj this needs to be at the bottom?

import { 
  createNotification, 
  getMyNotifications,
  getAllMyNotifications,
  markNotificationAsRead,
  getNotificationTypes  
} from "#db/queries/notifications";
import requireBody from "#middleware/requireBody";
import requireUser from "#middleware/requireUser"; // Added



router.get("/", async (req, res) => {
  try {
    const myNotifications = await getMyNotifications(req.user.user_id);
    // Return empty array instead of 404 so the frontend doesn't crash on new lobbies
    res.send(myNotifications || []);
  } catch (err) {
    res.status(500).send("Error fetching notifications");
  }
});

router.get("/mynotifications", requireUser, async (req, res) => {
  try {
    const allMyNotifications = await getAllMyNotifications(req.user.user_id);
    // Return empty array instead of 404 so the frontend doesn't crash on new lobbies
    res.send(allMyNotifications || []);
  } catch (err) {
    res.status(500).send("Error fetching notifications");
  }
});


// router.post("/", requireUser, requireBody(["user_id", "notification_type", "notification_text"]), async (req, res, next) => {
//   try {
//     // const { notification_type, notification_text } = req.body;
//     // const user_id = req.user.user_id; 
//     const { notification_type, notification_text } = req.body;
//     const user_id = req.body.user_id || req.user.user_id;
      
//     const notification = await createNotification(
//       user_id,
//       notification_type,
//       notification_text
//     );

//     // Spread the user's name back so the chat UI shows it immediately
//     res.status(201).send(notification);
//   } catch (err) {
//     next(err);
//   }
// });


router.post(
  "/",
  requireUser,
  requireBody([
    "user_id",
    "notification_type_id",
    "notification_text",
  ]),
  async (req, res, next) => {
    try {
      const { notification_type_id, notification_text } = req.body;

      const user_id = req.body.user_id || req.user.user_id;

      const notification = await createNotification(
        user_id,
        notification_type_id,
        notification_text
      );

      res.status(201).send(notification);
    } catch (err) {
      next(err);
    }
  }
);

router.patch("/:notificationId/read", requireUser, async (req, res, next) => {
  try {
    const notification = await markNotificationAsRead(
      req.params.notificationId,
      req.user.user_id
    );

    res.send(notification);
  } catch (err) {
    next(err);
  }
});


router.get("/types", async (req, res) => {
  try {
    const notificationTypes = await getNotificationTypes();
    res.send(notificationTypes || []);
  } catch (err) {
    res.status(500).send("Error fetching notification types");
  }
});




export default router;