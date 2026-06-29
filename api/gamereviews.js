import express from "express";
const router = express.Router();
export default router;

import fetch from "node-fetch";
import { getGameReviews, getGameReviewByID, incrementGameReviewViewCount } from "#db/queries/gamereviews";

import requireBody from "#middleware/requireBody";
import { createToken } from "#utils/jwt";


router.get("/", async (req, res) => {
  const gameReviews = await getGameReviews();
  res.send(gameReviews);
});

router.get("/:id", async (req, res) => {
  const gameReview = await getGameReviewByID(req.params.id);
  await incrementGameReviewViewCount(req.params.id);
  res.send(gameReview);
});