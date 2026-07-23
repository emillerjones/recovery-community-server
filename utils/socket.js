import { Server } from "socket.io";
import { getConversationForParticipant } from "#db/queries/messages";
import { verifyToken } from "#utils/jwt";

let io;

/** Attaches Socket.IO to the given HTTP server and sets up JWT auth + per-user rooms. */
export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const { id } = verifyToken(socket.handshake.auth?.token);
      socket.userId = id;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.userId}`);

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

/** Emits an event to everyone currently viewing a given forum thread. */
export function notifyThread(postId, event, payload) {
  io?.to(`post:${postId}`).emit(event, payload);
}

/** Emits an event to everyone currently viewing a given DM conversation. */
export function notifyConversation(conversationId, event, payload) {
  io?.to(`conversation:${conversationId}`).emit(event, payload);
}
