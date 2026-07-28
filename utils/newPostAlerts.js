import db from "#db/client";
import { getNewPostNotifications } from "#db/queries/notifications";
import { notifyUser } from "#utils/socket";

async function broadcastPost(postId) {
  if (!postId) return;
  const notifications = await getNewPostNotifications(postId);
  for (const notification of notifications) {
    notifyUser(notification.user_id, "notification", notification);
  }
}

export async function broadcastNewPostAlerts(postId) {
  // NEW POST ALERT TRACE STEP 4: normal forum posts arrive here immediately
  // after creation so online members see the persisted alert without refreshing.
  await broadcastPost(postId);
}

export async function broadcastMemberWelcomeAlerts(memberId) {
  // WELCOME POST TRACE STEP 4: all three approval paths call this same helper.
  // The unique welcome_member_id identifies the one post created by the trigger.
  const { rows: [post] } = await db.query(
    `SELECT post_id FROM posts WHERE welcome_member_id = $1`,
    [memberId]
  );
  await broadcastPost(post?.post_id);
}
