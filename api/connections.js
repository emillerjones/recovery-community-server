import express from "express";
const router = express.Router();
export default router;

import { updateUserSteamId } from "#db/queries/users";
import { updateUserXboxId } from "#db/queries/users";
import { updateUserBattleNet } from "#db/queries/users";

import jwt from "jsonwebtoken";
import { createToken } from "#utils/jwt";

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

// Steam
router.get("/steam", (req, res) => {
  const user = jwt.verify(req.query.token, process.env.JWT_SECRET);
  const linkToken = createToken({ id: user.id });
  const returnUrl = `${SERVER_URL}/api/connections/steam/callback?linkToken=${linkToken}`;
  const steamLoginUrl = "https://steamcommunity.com/openid/login?" +
    "openid.ns=http://specs.openid.net/auth/2.0" +
    "&openid.mode=checkid_setup" +
    "&openid.return_to=" + encodeURIComponent(returnUrl) +
    "&openid.realm=" + encodeURIComponent(SERVER_URL) +
    "&openid.identity=http://specs.openid.net/auth/2.0/identifier_select" +
    "&openid.claimed_id=http://specs.openid.net/auth/2.0/identifier_select";
  res.redirect(steamLoginUrl);
});

router.get("/steam/callback", async (req, res) => {
  console.log(req.query);
  const steamIdentity = req.query["openid.identity"];
  const steamId = steamIdentity.split("/").pop();
  const { id } = jwt.verify(req.query.linkToken, process.env.JWT_SECRET);
  const user = await updateUserSteamId(id, steamId);
  res.redirect(`${CLIENT_URL}/profile`);
  console.log("Steam ID:", steamId);
});

// Xbox
router.get("/xbox", async (req, res) => {
  const user = jwt.verify(req.query.token, process.env.JWT_SECRET);
  const xboxLoginURL =
    `https://api.xbl.io/app/auth/${process.env.OPENXBL_PUBLIC_KEY}` +
    `?state=${req.query.token}`;
  res.cookie("xbox_link_user_id", user.id, {
    httpOnly: true,
    sameSite: "none",
    secure: true,
  });
  res.redirect(xboxLoginURL);
});

router.get("/xbox/callback", async (req, res) => {
  console.log("OpenXBL callback query:", req.query);
  const { code } = req.query;
  const id = req.cookies.xbox_link_user_id;

  const claimRes = await fetch("https://api.xbl.io/app/claim", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code,
      app_key: process.env.OPENXBL_PUBLIC_KEY,
      client_secret: process.env.OPENXBL_CLIENT_SECRET,
    }),
  });

  const xblData = await claimRes.json();
  await updateUserXboxId(id, xblData.xuid, xblData.gamertag);
  console.log("XBL DATA:", xblData);
  res.redirect(`${CLIENT_URL}/profile`);
});

// Battle.net
router.get("/battlenet", (req, res) => {
  const user = jwt.verify(req.query.token, process.env.JWT_SECRET);
  const linkToken = createToken({ id: user.id });
  const redirectUri = `${SERVER_URL}/api/connections/battlenet/callback`;

  const authUrl =
    "https://oauth.battle.net/authorize" +
    "?client_id=" + process.env.BATTLENET_CLIENT_ID +
    "&response_type=code" +
    "&redirect_uri=" + encodeURIComponent(redirectUri) +
    "&scope=openid" +
    "&state=" + linkToken;

  res.redirect(authUrl);
});

router.get("/battlenet/callback", async (req, res, next) => {
  try {
    const { code, state } = req.query;
    const user = jwt.verify(state, process.env.JWT_SECRET);
    const redirectUri = `${SERVER_URL}/api/connections/battlenet/callback`;

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
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenRes.json();
    await updateUserBattleNet(user.id, tokenData.sub, null, "us");
    res.redirect(`${CLIENT_URL}/profile`);
  } catch (err) {
    next(err);
  }
});