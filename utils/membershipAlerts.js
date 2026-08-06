import { createPendingApplicationNotifications } from "#db/queries/notifications";
import { notifyUser } from "#utils/socket";

/** Persists the review alert, then delivers it immediately to online reviewers. */
export async function broadcastPendingApplicationAlerts(applicantId) {
  const notifications = await createPendingApplicationNotifications(applicantId);
  for (const notification of notifications) {
    notifyUser(notification.user_id, "notification", notification);
  }
  return notifications;
}
