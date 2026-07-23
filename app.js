import express from "express";
const app = express();
export default app;

import getUserFromToken from "#middleware/getUserFromToken";
import cors from "cors";
import cookieParser from "cookie-parser";
import usersRouter from "#api/users";
import contactRouter from "#api/contact";
import forumRouter from "#api/forum";
import notificationsRouter from "#api/notifications";


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(cookieParser());
app.use(getUserFromToken); 


app.use("/api/users", usersRouter);
app.use("/api/contact", contactRouter);
app.use("/api/forum", forumRouter);
app.use("/api/notifications", notificationsRouter);


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
