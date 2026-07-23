import http from "node:http";
import app from "#app";
import db from "#db/client";
import { initSocket } from "#utils/socket";

const PORT = process.env.PORT ?? 3000;

await db.connect();

const httpServer = http.createServer(app);
initSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Listening on port ${PORT}...`);
});

