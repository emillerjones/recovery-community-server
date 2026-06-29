import express from "express";
const router = express.Router();
export default router;

import fetch from "node-fetch";
// import { getGames, updateGameImage, getGamesForImageURL } from "#db/queries/games";

import requireBody from "#middleware/requireBody";
import { createToken } from "#utils/jwt";
// https://developer.valvesoftware.com/wiki/Steam_Web_API


//Routes
// Recent games
router.get("/:steamId/recent-games", async (req, res) => {
  const { steamId } = req.params;

  const url = `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/?key=${process.env.STEAM_API_KEY}&steamid=${steamId}&format=json`;

  const response = await fetch(url);
  const data = await response.json();

  res.send(data.response.games || []);
});

// Owned games
router.get("/:steamId/owned-games", async (req, res) => {
  const { steamId } = req.params;

  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${process.env.STEAM_API_KEY}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true&format=json`;

  const response = await fetch(url);
  const data = await response.json();

  res.send(data.response.games || []);
});

// Friends list
router.get("/:steamId/friends", async (req, res) => {
  const { steamId } = req.params;

  const url = `https://api.steampowered.com/ISteamUser/GetFriendList/v0001/?key=${process.env.STEAM_API_KEY}&steamid=${steamId}&relationship=friend&format=json`;

  const response = await fetch(url);
  const data = await response.json();

  res.send(data.friendslist?.friends || []);
});

// Player achievements for one game
router.get("/:steamId/achievements/:appId", async (req, res) => {
  const { steamId, appId } = req.params;

  const url = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?key=${process.env.STEAM_API_KEY}&steamid=${steamId}&appid=${appId}&l=english&format=json`;

  const response = await fetch(url);
  const data = await response.json();

  res.send(data.playerstats || {});
});

// Global achievement percentages for one game
router.get("/apps/:appId/global-achievements", async (req, res) => {
  const { appId } = req.params;

  const url = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${appId}&format=json`;

  const response = await fetch(url);
  const data = await response.json();

  res.send(data.achievementpercentages?.achievements || []);
});

// News for one game
router.get("/apps/:appId/news", async (req, res) => {
  const { appId } = req.params;

  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${appId}&count=5&maxlength=500&format=json`;

  const response = await fetch(url);
  const data = await response.json();

  res.send(data.appnews?.newsitems || []);
});



router.get("/:steamId", async (req, res) => {
  const { steamId } = req.params;

  const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${process.env.STEAM_API_KEY}&steamids=${steamId}`;

  const response = await fetch(url);
  const data = await response.json();

  res.send(data);
});


