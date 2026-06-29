import express from "express";
const router = express.Router();
export default router;

import fetch from "node-fetch";
import { getGames, updateGameImage, getGamesForImageURL, getGameById } from "#db/queries/games";

import requireBody from "#middleware/requireBody";
import { createToken } from "#utils/jwt";


//EMJ - This feels very public so we'll leave it simple
router.get("/", async (req, res) => {
  const games = await getGames();
  res.send(games);
});








//EMJ Testing twich api for game images
router.get("/test", async (req, res) => {
  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
  });
  const tokenData = await response.json();
  const accessToken = tokenData.access_token;
  
  const games = await getGames();
  const firstGame = games[0];

  const response2 = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      "Client-ID": process.env.TWITCH_CLIENT_ID,
      "Authorization": `Bearer ${accessToken}`,
    },
    body: `search "${firstGame.game_title}"; fields name, cover.url;`
  });
  
  const data = await response2.json();
  res.send(data);
});



router.get("/populate-images", async (req, res) => {
  // const games = await getGames();
  // const games = (await getGamesForImageURL()).slice(110, 120);
  const games = await getGamesForImageURL();

  const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
  });

  const tokenData = await tokenResponse.json();
  const accessToken = tokenData.access_token;

  for (let game of games) {
    const igdbResponse = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        "Authorization": `Bearer ${accessToken}`,
      },
      body: `search "${game.game_title}"; fields name, cover.url; limit 1;`,
    });

    const igdbData = await igdbResponse.json();

    const match = igdbData[0];
    // const imageUrl = match?.cover?.url ? "https:" + match.cover.url : null;
    const imageUrl = match?.cover?.url
      ? "https:" + match.cover.url.replace("t_thumb", "t_1080p")
      : null;


    if (imageUrl) {
      await updateGameImage(game.game_id, imageUrl);
    }
    console.log(game.game_title);
    console.log(igdbData);
    await new Promise(res => setTimeout(res, 300));
  }

  res.send("started/finishedd");
});

router.get("/:id", async (req, res) => {
  const game = await getGameById(req.params.id);

  if (!game) {
    return res.status(404).send("Game not found");
  }

  res.send(game);
});