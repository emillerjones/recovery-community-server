import { Server } from "socket.io";
import { getConversationForParticipant } from "#db/queries/messages";
import { getUserById } from "#db/queries/users";
import { verifyToken } from "#utils/jwt";
import { canUseStaffChat } from "#utils/staffChatAccess";
import { getStaffChatRoom } from "#db/queries/staffChat";
import { getForumPostAccess } from "#utils/forumAccess";

let io;
const onlineUserSockets = new Map();
const onlineMembers = new Map();

function presencePayload() {
  return {
    online_count: onlineUserSockets.size,
    online_members: [...onlineMembers.values()].slice(0, 12),
  };
}

function broadcastPresence() {
  io?.emit("community_presence", presencePayload());
}

/** Attaches Socket.IO to the given HTTP server and sets up JWT auth + per-user rooms. */
export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const { id, auth_version: tokenAuthVersion = 0 } = verifyToken(socket.handshake.auth?.token);
      const user = await getUserById(id);
      if (!user || user.auth_version !== tokenAuthVersion || user.account_status !== "approved" || !user.active || user.deleted_at) {
        return next(new Error("Unauthorized"));
      }
      socket.userId = user.user_id;
      socket.member = {
        user_id: user.user_id,
        username: user.username,
        avatar_url: user.avatar_url,
      };
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.userId}`);

    // One member may have several tabs/devices. Count unique user IDs rather
    // than sockets so the navbar presence number stays honest.
    const userSockets = onlineUserSockets.get(socket.userId) || new Set();
    userSockets.add(socket.id);
    onlineUserSockets.set(socket.userId, userSockets);
    onlineMembers.set(socket.userId, socket.member);
    broadcastPresence();

    // React may attach its Lounge listener just after this socket connects.
    // Let the client request the current count instead of waiting for the next
    // member to connect or disconnect before its number is corrected.
    socket.on("request_community_presence", () => {
      socket.emit("community_presence", presencePayload());
    });

    socket.on("disconnect", () => {
      const remainingSockets = onlineUserSockets.get(socket.userId);
      remainingSockets?.delete(socket.id);
      if (!remainingSockets?.size) {
        onlineUserSockets.delete(socket.userId);
        onlineMembers.delete(socket.userId);
      }
      broadcastPresence();
    });

    socket.on("join_thread", async (postId, ack) => {
      const room = `post:${Number(postId)}`;
      socket.threadRequests ??= new Map();
      const requestId = Symbol();
      socket.threadRequests.set(room, requestId);
      try {
        const access = await authorizedThreadSocket(socket, Number(postId));
        const allowed = Boolean(access && socket.connected && socket.threadRequests.get(room) === requestId);
        if (allowed) socket.join(room);
        if (typeof ack === "function") ack({ ok: allowed });
      } catch {
        if (typeof ack === "function") ack({ ok: false });
      }
    });
    socket.on("leave_thread", (postId) => {
      const room = `post:${Number(postId)}`;
      socket.threadRequests?.delete(room);
      socket.leave(room);
    });

    socket.on("join_conversation", async (conversationId) => {
      const parsedConversationId = Number(conversationId);
      if (!Number.isInteger(parsedConversationId) || parsedConversationId <= 0) return;

      try {
        const conversation = await getConversationForParticipant(
          parsedConversationId,
          socket.userId
        );

        // Private message rooms are only available to their two participants.
        if (!conversation) return;
        socket.join(`conversation:${parsedConversationId}`);
      } catch (error) {
        console.error("Could not authorize conversation socket room:", error);
      }
    });
    socket.on("leave_conversation", (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
    });

    socket.on("join_staff_chat", async (ack) => {
      const requestId = (socket.staffChatRequestId || 0) + 1;
      socket.staffChatRequestId = requestId;
      try {
        const allowed = await authorizedStaffSocket(socket) && await getStaffChatRoom();
        if (allowed && socket.connected && socket.staffChatRequestId === requestId) socket.join("staff-chat");
        if (typeof ack === "function") ack({ ok: Boolean(allowed) });
      } catch {
        if (typeof ack === "function") ack({ ok: false });
      }
    });
    socket.on("leave_staff_chat", () => {
      socket.staffChatRequestId = (socket.staffChatRequestId || 0) + 1;
      socket.leave("staff-chat");
    });
  });

  return io;
}

/** Emits an event to every connection open for a given user (0 or more tabs/devices). */
export function notifyUser(userId, event, payload) {
  io?.to(`user:${userId}`).emit(event, payload);
}

/** Password changes revoke every live tab/device for the affected member. */
export function disconnectUser(userId) {
  const userRoom = io?.in(`user:${userId}`);
  userRoom?.emit("session_revoked");
  userRoom?.disconnectSockets(true);
}

/** Emits an event to everyone currently viewing a given forum thread. */
async function authorizedThreadSocket(socket, postId) {
  const token = verifyToken(socket.handshake.auth?.token);
  const user = await getUserById(socket.userId);
  if (!user || !user.active || user.deleted_at || user.account_status !== "approved" || user.auth_version !== (token.auth_version ?? 0)) return null;
  return getForumPostAccess(postId, user);
}

export async function notifyThread(postId, event, payload) {
  if (!io) return;
  const room = `post:${postId}`;
  for (const socketId of io.sockets.adapter.rooms.get(room) || []) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    try {
      if (await authorizedThreadSocket(socket, Number(postId))) socket.emit(event, payload);
      else { socket.leave(room); socket.emit("forum_access_revoked", { post_id: Number(postId) }); }
    } catch {
      // Fail closed if current access cannot be verified.
      socket.leave(room);
    }
  }
}

/** Emits an event to everyone currently viewing a given DM conversation. */
export function notifyConversation(conversationId, event, payload) {
  io?.to(`conversation:${conversationId}`).emit(event, payload);
}

/** Every approved connected member is already part of the persistent Lounge. */
export function notifyLounge(event, payload) {
  io?.emit(event, payload);
}

async function authorizedStaffSocket(socket) {
  const token = verifyToken(socket.handshake.auth?.token);
  const user = await getUserById(socket.userId);
  return canUseStaffChat(user) && user.auth_version === (token.auth_version ?? 0);
}

// Never use the public Lounge broadcast for staff content. Recheck the database
// and token for every recipient, including sockets opened before a demotion.
export async function notifyStaffChat(event, payload) {
  if (!io) return;
  try {
    if (!await getStaffChatRoom()) return;
    for (const socketId of io.sockets.adapter.rooms.get("staff-chat") || []) {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) continue;
      try {
        if (await authorizedStaffSocket(socket)) socket.emit(event, payload);
        else revokeStaffChat(socket.userId);
      } catch {
        socket.leave("staff-chat");
        socket.emit("staff_chat_revoked");
      }
    }
  } catch (error) {
    // The message is already saved. Do not invite a duplicate send on delivery failure.
    console.error("Staff Chat live delivery failed:", error.message);
  }
}

export function revokeStaffChat(userId) {
  io?.in(`user:${userId}`).socketsLeave("staff-chat");
  io?.to(`user:${userId}`).emit("staff_chat_revoked");
}

export function getOnlineUserCount() {
  return onlineUserSockets.size;
}

export function getOnlineMembers() {
  return presencePayload().online_members;
}
