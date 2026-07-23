import { Server } from "socket.io";
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
  });

  return io;
}

/** Emits an event to every connection open for a given user (0 or more tabs/devices). */
export function notifyUser(userId, event, payload) {
  io?.to(`user:${userId}`).emit(event, payload);
}
