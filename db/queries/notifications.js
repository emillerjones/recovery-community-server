import db from "#db/client";
// import bcrypt from "bcrypt";



// export async function createNotification(user_id, notification_type, notification_text) {
//   const sql = `
//   INSERT INTO notifications
//     (
//       user_id
//       ,notification_type
//       ,notification_text
//     )
//   VALUES
//     (
//       $1,$2,$3
//     )
//   RETURNING *
//   `;
//   const { rows: [notification] } = await db.query(sql, [user_id, notification_type, notification_text]);
//   return notification;
// }
export async function createNotification(
  user_id,
  notification_type_id,
  notification_text
) {
  const sql = `
    INSERT INTO notifications
    (
      user_id,
      notification_type_id,
      notification_text
    )
    VALUES
    (
      $1, $2, $3
    )
    RETURNING *
  `;

  const {
    rows: [notification],
  } = await db.query(sql, [
    user_id,
    notification_type_id,
    notification_text,
  ]);

  return notification;
}

// export async function getMyNotifications(user_id){
//   const sql = `
//   SELECT *
//   FROM notifications
//   WHERE user_id = $1 AND is_read = false
//   ORDER BY created_at DESC
//   `;
//   const { rows: notifications } = await db.query(sql, [user_id]);
//   return notifications;
// }
export async function getMyNotifications(user_id) {
  const sql = `
    SELECT
      notifications.*,
      notification_types.display_name,
      notification_types.icon,
      notification_types.category

    FROM notifications

    LEFT JOIN notification_types
      ON notifications.notification_type_id =
         notification_types.notification_type_id

    WHERE notifications.user_id = $1
      AND notifications.is_read = false

    ORDER BY notifications.created_at DESC
  `;

  const { rows: notifications } = await db.query(sql, [user_id]);

  return notifications;
}

// export async function getAllMyNotifications(user_id){
//   const sql = `
//   SELECT *
//   FROM notifications
//   WHERE user_id = $1
//   ORDER BY created_at DESC
//   `;
//   const { rows: notifications } = await db.query(sql, [user_id]);
//   return notifications;
// }
export async function getAllMyNotifications(user_id) {
  const sql = `
    SELECT
      notifications.*,
      notification_types.display_name,
      notification_types.icon,
      notification_types.category

    FROM notifications

    LEFT JOIN notification_types
      ON notifications.notification_type_id =
         notification_types.notification_type_id

    WHERE notifications.user_id = $1

    ORDER BY notifications.created_at DESC
  `;

  const { rows: notifications } = await db.query(sql, [user_id]);

  return notifications;
}


export async function markNotificationAsRead(notification_id, user_id) {
  const sql = `
    UPDATE notifications
    SET is_read = true,
        read_at = NOW()
    WHERE notification_id = $1
      AND user_id = $2
    RETURNING *
  `;

  const { rows: [notification] } = await db.query(sql, [
    notification_id,
    user_id,
  ]);

  return notification;
}


export async function getNotificationTypes(){
  const sql = `
    SELECT *
    FROM notification_types
    WHERE active = true
    ORDER BY display_name; 
  `;
  const { rows: notificationTypes } = await db.query(sql);
  return notificationTypes;
}

