import express from "express";
const app = express();
export default app;

// import morgan from "morgan"; // Disabled due to CommonJS/ESM compatibility issue
import getUserFromToken from "#middleware/getUserFromToken";
import cors from "cors";
import cookieParser from "cookie-parser";

import usersRouter from "#api/users"; 
import friendsListRouter from '#api/friendslist';
import gamesRouter from "#api/games";
import sessionsRouter from "#api/sessions";
import sessionMessagesRouter from "#api/sessionmessages";
import gameReviewsRouter from "#api/reviews";
import sessionReviewsRouter from "#api/session-reviews";

import steamRouter from "#api/steam";
import xboxRouter from "#api/xbox";
import battleNetRouter from "#api/battlenet";
import connectionsRouter from "./api/connections.js";
import psnRouter from "./api/playstation.js";
import notficationsRouter from "./api/notifications.js";
import raidHelperRouter from "./api/raidhelper.js";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(getUserFromToken); 
app.use(cookieParser());

app.use("/api/users", usersRouter);
app.use("/api/friendslist", friendsListRouter);
app.use("/api/games", gamesRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/session-messages", sessionMessagesRouter);
app.use("/api/game-reviews", gameReviewsRouter);
app.use("/api/session-reviews", sessionReviewsRouter);

app.use("/api/battlenet", battleNetRouter);
app.use("/api/steam", steamRouter);
app.use("/api/xbox", xboxRouter);
app.use("/api/connections", connectionsRouter);
app.use("/api/playstation", psnRouter);
app.use("/api/notifications", notficationsRouter);
app.use("/api/raidhelper", raidHelperRouter);

app.use((err, req, res, next) => {
  // A switch statement can be used instead of if statements
  // when multiple cases are handled the same way.
  switch (err.code) {
    // Invalid type
    case "22P02":
      return res.status(400).send(err.message);
    // Unique constraint violation
    case "23505":
    // Foreign key violation
    case "23503":
      return res.status(400).send(err.detail);
    default:
      next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send({message:"Sorry! Something went wrong."});
});
