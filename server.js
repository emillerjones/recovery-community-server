import http from "node:http";
import app from "#app";
import db from "#db/client";
import { initSocket } from "#utils/socket";
import { startModerationProcessor } from "#utils/loungeModerationProcessor";

const PORT = process.env.PORT ?? 3000;

// Fail the deployment immediately if PostgreSQL is unavailable at startup.
// After startup, the pool in db/client.js replaces individual connections
// when a temporary network or database interruption terminates one.
await db.query("SELECT 1");

const httpServer = http.createServer(app);
initSocket(httpServer);
const stopModeration = startModerationProcessor();
process.once('SIGTERM', stopModeration);
process.once('SIGINT', stopModeration);

httpServer.listen(PORT, () => {
  console.log(`Listening on port ${PORT}...`);
});

