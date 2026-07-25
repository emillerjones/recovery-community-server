import http from "node:http";
import app from "#app";
import db from "#db/client";
import { initSocket } from "#utils/socket";

const PORT = process.env.PORT ?? 3000;

// Fail the deployment immediately if PostgreSQL is unavailable at startup.
// After startup, the pool in db/client.js replaces individual connections
// when a temporary network or database interruption terminates one.
await db.query("SELECT 1");

const httpServer = http.createServer(app);
initSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Listening on port ${PORT}...`);
});

