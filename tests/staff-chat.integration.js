import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import express from "express";

// Reuse the sibling application's Socket.IO client without changing dependencies.
const clientRequire = createRequire(new URL("../../recovery-community-client/package.json", import.meta.url));
const { io: connectSocket } = clientRequire("socket.io-client");
process.env.DB_CLIENT_MODE = "single";
const { default: db } = await import("../db/client.js");
const { default: staffChat } = await import("../api/staffChat.js");
const { default: lounge } = await import("../api/lounge.js");
const { default: getUserFromToken } = await import("../middleware/getUserFromToken.js");
const { createToken } = await import("../utils/jwt.js");
const { initSocket, revokeStaffChat } = await import("../utils/socket.js");
const schema = `test_staff_chat_${randomUUID().replaceAll("-", "")}`;
let server, io;
const sockets = [];
await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`SET LOCAL search_path TO ${schema}`);
  await db.query(`CREATE TABLE users (
    user_id SERIAL PRIMARY KEY, username TEXT, role_id INT, avatar_url TEXT,
    account_status TEXT DEFAULT 'approved', active BOOLEAN DEFAULT TRUE,
    deleted_at TIMESTAMPTZ, is_system BOOLEAN DEFAULT FALSE, auth_version INT DEFAULT 0
  )`);
  // Exercise the actual upgrade from the original Lounge, twice for idempotency.
  for (const file of ["014_add_community_lounge.sql", "023_add_staff_chat.sql", "023_add_staff_chat.sql"]) {
    const sql = await fs.readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8");
    await db.query(sql.replace(/^BEGIN;|^COMMIT;/gm, ""));
  }
  const rooms = (await db.query("SELECT slug,access_level FROM lounge_rooms ORDER BY slug")).rows;
  assert.deepEqual(rooms, [{ slug: "community-lounge", access_level: "members" }, { slug: "staff-chat", access_level: "staff" }]);
  const { rows: users } = await db.query(`INSERT INTO users (username,role_id) VALUES
    ('member',100),('moderator',50),('admin',10),('owner',1),('other-member',100) RETURNING *`);
  const [member, moderator, admin, owner] = users;
  const tokens = new Map(users.map(user => [user.user_id, createToken({ id: user.user_id, role_id: user.role_id, auth_version: 0 })]));
  const app = express();
  app.use(express.json());
  app.use(getUserFromToken);
  app.use('/api/staff-chat', staffChat);
  app.use('/api/lounge', lounge);
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  io = initSocket(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(user, path = '/api/staff-chat/messages', method = 'GET', body) {
    const response = await fetch(base + path, {
      method, headers: { ...(user ? { Authorization: `Bearer ${tokens.get(user.user_id)}` } : {}), 'Content-Type': 'application/json' },
      ...(body && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return { status: response.status, data: (() => { try { return JSON.parse(text); } catch { return text; } })() };
  }
  async function socketFor(user) {
    const socket = connectSocket(base, { auth: { token: tokens.get(user.user_id) }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  }
  const memberSocket = await socketFor(member);
  const moderatorSocket = await socketFor(moderator);
  const ownerSocket = await socketFor(owner);
  const memberEvents = [], moderatorEvents = [], ownerEvents = [], publicEvents = [];
  memberSocket.on('staff_chat_message', value => memberEvents.push(value));
  moderatorSocket.on('staff_chat_message', value => moderatorEvents.push(value));
  ownerSocket.on('staff_chat_message', value => ownerEvents.push(value));
  memberSocket.on('lounge_message', value => publicEvents.push(value));
  const join = socket => socket.timeout(3000).emitWithAck('join_staff_chat');
  assert.equal((await join(memberSocket)).ok, false);
  assert.equal((await join(moderatorSocket)).ok, true);
  assert.equal((await join(ownerSocket)).ok, true);
  for (const method of ['GET', 'POST', 'DELETE']) {
    const path = '/api/staff-chat/messages' + (method === 'DELETE' ? '/1' : '');
    assert.equal((await request(null, path, method, { body: 'Denied' })).status, 401);
    assert.equal((await request(member, path, method, { body: 'Denied' })).status, 403);
  }
  for (const staff of [moderator, admin, owner]) assert.equal((await request(staff)).status, 200);
  assert.equal((await request(owner, '/api/staff-chat/messages?before=bad')).status, 400);
  for (const body of ['', ' ', 'x'.repeat(1001)]) assert.equal((await request(owner, undefined, 'POST', { body })).status, 400);
  const sent = await request(moderator, undefined, 'POST', { body: 'Private staff conversation' });
  assert.equal(sent.status, 201);
  // An acknowledged Socket.IO event acts as a delivery barrier, without sleeps.
  await join(ownerSocket); await join(moderatorSocket); await join(memberSocket);
  assert.equal(ownerEvents.length, 1);
  assert.equal(moderatorEvents.length, 1);
  assert.equal(memberEvents.length, 0);
  assert.equal(publicEvents.length, 0);
  assert.equal((await request(owner)).data.messages[0].body, 'Private staff conversation');
  assert.equal((await request(member, '/api/lounge/messages')).data.messages.length, 0);
  assert.equal((await request(member, '/api/lounge/status')).data.unread_count, 0);
  assert.equal((await request(owner, `/api/lounge/messages/${sent.data.message_id}`, 'DELETE')).status, 403);
  const publicSent = await request(member, '/api/lounge/messages', 'POST', { body: 'Public Lounge message' });
  assert.equal(publicSent.status, 201);
  assert.equal((await request(owner, `/api/staff-chat/messages/${publicSent.data.message_id}`, 'DELETE')).status, 404);
  assert.equal((await request(owner, `/api/staff-chat/messages/${sent.data.message_id}`, 'DELETE')).status, 200);
  assert.equal((await request(owner)).data.messages[0].body, null);

  // Bulk fixtures exercise history boundaries without hitting the sender limit.
  await db.query(`INSERT INTO lounge_messages(room_id,author_id,author_username,body)
    SELECT room_id,$1,'owner','History ' || n FROM lounge_rooms CROSS JOIN generate_series(1,55) n WHERE slug='staff-chat'`, [owner.user_id]);
  const firstPage = (await request(owner)).data;
  const secondPage = (await request(owner, `/api/staff-chat/messages?before=${firstPage.nextCursor}`)).data;
  assert.equal(firstPage.messages.length, 50);
  assert.equal(firstPage.hasMore, true);
  assert.equal(secondPage.messages.length, 6);
  assert.equal(new Set([...firstPage.messages, ...secondPage.messages].map(message => message.message_id)).size, 56);
  assert.equal(secondPage.hasMore, false);

  // A token and live socket opened before demotion must not retain access.
  await db.query('UPDATE users SET role_id=100 WHERE user_id=$1', [moderator.user_id]);
  const oldCount = moderatorEvents.length;
  assert.equal((await request(moderator)).status, 403);
  assert.equal((await request(moderator, undefined, 'POST', { body: 'Denied after demotion' })).status, 403);
  await request(owner, undefined, 'POST', { body: 'After demotion' });
  await join(ownerSocket); await join(moderatorSocket);
  assert.equal(moderatorEvents.length, oldCount);
  assert.equal((await join(moderatorSocket)).ok, false);
  assert.equal(memberEvents.length, 0);
  await db.query('UPDATE users SET role_id=50,active=FALSE WHERE user_id=$1', [moderator.user_id]);
  assert.equal((await request(moderator)).status, 403);
  assert.equal((await join(moderatorSocket)).ok, false);
  await db.query("UPDATE users SET active=TRUE,account_status='pending' WHERE user_id=$1", [moderator.user_id]);
  assert.equal((await request(moderator)).status, 403);
  await db.query("UPDATE users SET account_status='approved',auth_version=1 WHERE user_id=$1", [moderator.user_id]);
  assert.equal((await request(moderator)).status, 401);
  assert.equal((await join(moderatorSocket)).ok, false);
  const revoked = new Promise(resolve => ownerSocket.once('staff_chat_revoked', resolve));
  revokeStaffChat(owner.user_id);
  await revoked;
  assert.equal(io.sockets.adapter.rooms.get('staff-chat')?.size || 0, 0);
  await db.query("UPDATE lounge_rooms SET active=FALSE WHERE slug='staff-chat'");
  assert.equal((await request(owner)).status, 503);
  assert.equal((await join(ownerSocket)).ok, false);
  assert.equal((await request(member, '/api/lounge/messages')).status, 200);
  console.log('PASS: migration twice, all staff roles, denied member/guest access, private live delivery, cross-room deletion, pagination, demotion, suspension, revoked sessions, kill switch, and unchanged public Lounge.');
} finally {
  for (const socket of sockets) socket.disconnect();
  if (io) await new Promise(resolve => io.close(resolve));
  else if (server) await new Promise(resolve => server.close(resolve));
  await db.query('ROLLBACK');
  await db.end();
}
