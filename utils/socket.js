import { Server } from "socket.io";
import { getConversationForParticipant } from "#db/queries/messages";
import { getUserById } from "#db/queries/users";
import { verifyToken } from "#utils/jwt";

let io;
const onlineUserSockets = new Map();

function broadcastPresence() {
  io?.emit("community_presence", { online_count: onlineUserSockets.size });
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
    broadcastPresence();

    // React may attach its Lounge listener just after this socket connects.
    // Let the client request the current count instead of waiting for the next
    // member to connect or disconnect before its number is corrected.
    socket.on("request_community_presence", () => {
      socket.emit("community_presence", {
        online_count: onlineUserSockets.size,
      });
    });

    socket.on("disconnect", () => {
      const remainingSockets = onlineUserSockets.get(socket.userId);
      remainingSockets?.delete(socket.id);
      if (!remainingSockets?.size) onlineUserSockets.delete(socket.userId);
      broadcastPresence();
    });

    socket.on("join_thread", (postId) => {
      socket.join(`post:${postId}`);
    });
    socket.on("leave_thread", (postId) => {
      socket.leave(`post:${postId}`);
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
export function notifyThread(postId, event, payload) {
  io?.to(`post:${postId}`).emit(event, payload);
}

/** Emits an event to everyone currently viewing a given DM conversation. */
export function notifyConversation(conversationId, event, payload) {
  io?.to(`conversation:${conversationId}`).emit(event, payload);
}

/** Every approved connected member is already part of the persistent Lounge. */
export function notifyLounge(event, payload) {
  io?.emit(event, payload);
}

export function getOnlineUserCount() {
  return onlineUserSockets.size;
}
