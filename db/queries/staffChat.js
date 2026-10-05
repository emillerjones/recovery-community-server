import db from "#db/client";

export async function getStaffChatRoom() {
  try {
    const { rows: [room] } = await db.query(
      "SELECT room_id FROM lounge_rooms WHERE slug = 'staff-chat' AND access_level = 'staff' AND active = TRUE"
    );
    return room;
  } catch (error) {
    // During a staged deployment, stay unavailable until the migration exists.
    if (error.code === "42703" || error.code === "42P01") return null;
    throw error;
  }
}
