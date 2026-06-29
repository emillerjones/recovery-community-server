import express from "express";
const router = express.Router();
export default router;

import fetch from "node-fetch";
// import { getGames, updateGameImage, getGamesForImageURL } from "#db/queries/games";

import requireBody from "#middleware/requireBody";
import { createToken } from "#utils/jwt";
// https://api.xbl.io/docs#description/quick-start


//Routes
router.get("/account", async (req, res) => {
  const response = await fetch("https://xbl.io/api/v2/account", {
    headers: {
      "X-Authorization": process.env.OPENXBL_API_KEY,
    },
  });

  const data = await response.json();
  res.send(data);
});


router.get("/:xuid/profile", async (req, res) => {
  const { xuid } = req.params;

  const response = await fetch(`https://xbl.io/api/v2/account/${xuid}`, {
    headers: {
      "X-Authorization": process.env.OPENXBL_API_KEY,
    },
  });

  console.log("XUID:", xuid);
  console.log("OpenXBL status:", response.status);

  const data = await response.json();

  res.status(response.status).send({
    status: response.status,
    data,
  });
});