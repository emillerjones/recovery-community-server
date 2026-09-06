import assert from "node:assert/strict";
import fs from "node:fs/promises";
import db from "#db/client";
import {
  getConversationsForUser,
  getMessages,
  getOrCreateConversation,
  sendMessage,
} from "#db/queries/messages";
import { getViewableMedia } from "#db/queries/media";

const schemaName = "codex_direct_message_photos_integration";

await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await db.query(`CREATE SCHEMA ${schemaName}`);
  await db.query(`SET LOCAL search_path TO ${schemaName}`);
  await db.query(await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));

  await db.query("INSERT INTO user_roles (role_id, role_name) VALUES (100, 'Member')");
  const { rows: users } = await db.query(
    `INSERT INTO users (role_id, email, password, username, account_status)
     VALUES (100, 'dm-sender@example.com', 'unused', 'dm-sender', 'pending'),
            (100, 'dm-recipient@example.com', 'unused', 'dm-recipient', 'pending'),
            (100, 'dm-outsider@example.com', 'unused', 'dm-outsider', 'pending')
     RETURNING user_id, username`
  );
  const sender = users.find((user) => user.username === "dm-sender");
  const recipient = users.find((user) => user.username === "dm-recipient");
  const outsider = users.find((user) => user.username === "dm-outsider");
  const conversation = await getOrCreateConversation(sender.user_id, recipient.user_id);

  const { rows: media } = await db.query(
    `INSERT INTO media_assets (
       uploaded_by, provider_asset_id, format, byte_size, width, height
     ) VALUES
       ($1, 'test/dm-one', 'webp', 101, 800, 600),
       ($1, 'test/dm-two', 'webp', 102, 600, 800),
       ($1, 'test/dm-three', 'webp', 103, 900, 700),
       ($1, 'test/dm-four', 'webp', 104, 700, 900),
       ($1, 'test/dm-five', 'webp', 105, 700, 700),
       ($2, 'test/dm-not-owned', 'webp', 106, 700, 700)
     RETURNING *`,
    [sender.user_id, outsider.user_id]
  );

  const textMessage = await sendMessage({
    conversationId: conversation.conversation_id,
    senderId: sender.user_id,
    body: "Text still works.",
  });
  assert.equal(textMessage.body, "Text still works.");
  assert.deepEqual(textMessage.images, []);

  const photoMessage = await sendMessage({
    conversationId: conversation.conversation_id,
    senderId: sender.user_id,
    body: "",
    mediaIds: [media[0].media_id, media[1].media_id],
  });
  assert.equal(photoMessage.body, "");
  assert.equal(photoMessage.images.length, 2);

  const combinedMessage = await sendMessage({
    conversationId: conversation.conversation_id,
    senderId: sender.user_id,
    body: "Two more photos",
    mediaIds: [media[2].media_id, media[3].media_id],
  });
  assert.equal(combinedMessage.images.length, 2);

  const loadedMessages = await getMessages(conversation.conversation_id);
  assert.equal(loadedMessages.length, 3);
  assert.equal(loadedMessages[1].images.length, 2);
  assert.equal(loadedMessages[2].body, "Two more photos");

  const conversations = await getConversationsForUser(recipient.user_id);
  assert.equal(conversations[0].last_message_body, "Two more photos");
  assert.equal(conversations[0].last_message_image_count, 2);

  assert.ok(await getViewableMedia(media[0].media_id, sender.user_id));
  assert.ok(await getViewableMedia(media[0].media_id, recipient.user_id));
  assert.equal(await getViewableMedia(media[0].media_id, outsider.user_id), undefined);

  const beforeRejected = await db.query("SELECT COUNT(*)::INT AS count FROM direct_messages");
  await assert.rejects(
    sendMessage({
      conversationId: conversation.conversation_id,
      senderId: sender.user_id,
      body: "Not my photo",
      mediaIds: [media[5].media_id],
    }),
    /photos are unavailable/
  );
  await assert.rejects(
    sendMessage({
      conversationId: conversation.conversation_id,
      senderId: outsider.user_id,
      body: "Not a participant",
    }),
    /Conversation not found/
  );
  await assert.rejects(
    sendMessage({
      conversationId: conversation.conversation_id,
      senderId: sender.user_id,
      body: "Too many",
      mediaIds: media.slice(0, 5).map((asset) => asset.media_id),
    }),
    /up to four/
  );
  await assert.rejects(
    sendMessage({
      conversationId: conversation.conversation_id,
      senderId: sender.user_id,
      body: "Duplicate",
      mediaIds: [media[4].media_id, media[4].media_id],
    }),
    /up to four/
  );
  await assert.rejects(
    sendMessage({
      conversationId: conversation.conversation_id,
      senderId: sender.user_id,
      body: "",
    }),
    /message or photo/
  );
  const afterRejected = await db.query("SELECT COUNT(*)::INT AS count FROM direct_messages");
  assert.equal(afterRejected.rows[0].count, beforeRejected.rows[0].count);
  assert.equal((await db.query(
    "SELECT status FROM media_assets WHERE media_id = $1",
    [media[5].media_id]
  )).rows[0].status, "pending");

  console.log("DIRECT_MESSAGE_PHOTOS_INTEGRATION_OK text=covered photo_only=covered privacy=covered rollback=covered");
} finally {
  await db.query("ROLLBACK").catch(() => {});
  await db.end();
}
