import express from "express";
const router = express.Router();
export default router;
import fetch from "node-fetch";

import requireBody from "#middleware/requireBody";
import requireUser from "#middleware/requireUser";
import { createToken } from "#utils/jwt";
import { upsertRaidHelperEvent, getRaidHelperEventsByUserId } from "#db/queries/raidhelper";

router.get("/events",  async (req, res, next) => {
  try {
    const response = await fetch(
      `https://raid-helper.xyz/api/v4/users/${process.env.RAID_HELPER_API_KEY}/events`
    );

    const events = await response.json();
    res.send(events);
  } catch (err) {
    next(err);
  }
});

router.post("/import",  async (req, res, next) => {
  try {
    const raids = req.body;
    const userId = 1; // temporary until we put requireUser back

    const importedRaids = [];

    for (const raid of raids) {
      const importedRaid = await upsertRaidHelperEvent(userId, raid);
      importedRaids.push(importedRaid);
    }

    res.send({
      message: "Raid import saved",
      count: importedRaids.length,
      raids: importedRaids,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/imported",  async (req, res, next) => {
  try {
    // console.log("Logged in user:", req.user.user_id);
    const raids = await getRaidHelperEventsByUserId();
    console.log("Raids found:", raids.length);
    res.send(raids);
  } catch (err) {
    next(err);
  }
});