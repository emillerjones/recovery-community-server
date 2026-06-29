import express from "express";
const router = express.Router();
export default router;

import fetch from "node-fetch";
// import { getGames, updateGameImage, getGamesForImageURL } from "#db/queries/games";

import requireBody from "#middleware/requireBody";
import { createToken } from "#utils/jwt";
// http://localhost:3000/api/battlenet/52188510/profile


//Routes
router.get("/:battleNetId/profile", async (req, res, next) => {
  try {
    const { battleNetId } = req.params;

    // 1. get app access token
    const tokenRes = await fetch("https://oauth.battle.net/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(
            process.env.BATTLENET_CLIENT_ID +
              ":" +
              process.env.BATTLENET_CLIENT_SECRET
          ).toString("base64"),
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
      }),
    });

    const tokenData = await tokenRes.json();

    // 2. call Blizzard API
    const profileRes = await fetch(
      `https://us.api.blizzard.com/profile/user/wow?namespace=profile-us&locale=en_US`,
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      }
    );

    // const profileData = await profileRes.json();
    // res.json(profileData);
    const text = await profileRes.text();
    res.status(profileRes.status).send(text);

  } catch (err) {
    next(err);
  }
});