import express from "express";
import requireUser from "#middleware/requireUser";
import { getFaq2Page, updateFaq2Page } from "#db/queries/faq2";

const router = express.Router();
const ICONS = new Set(["leaf", "shield", "door"]);

function cleanText(value, label, maxLength) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const text = value.trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maxLength) throw new Error(`${label} is too long.`);
  return text;
}

function validateContent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("FAQ content is required.");
  }
  const hero = {
    kicker: cleanText(input.hero?.kicker, "Hero label", 120),
    title: cleanText(input.hero?.title, "Hero title", 180),
    intro: cleanText(input.hero?.intro, "Hero introduction", 600),
  };
  if (!Array.isArray(input.groups) || input.groups.length < 1 || input.groups.length > 8) {
    throw new Error("FAQ content must contain between 1 and 8 sections.");
  }

  const groupKeys = new Set();
  const itemIds = new Set();
  let itemCount = 0;
  const groups = input.groups.map((group, groupIndex) => {
    const key = cleanText(group?.key, `Section ${groupIndex + 1} key`, 50);
    if (!/^[a-z0-9-]+$/.test(key) || groupKeys.has(key)) {
      throw new Error("Every FAQ section needs a unique simple key.");
    }
    groupKeys.add(key);
    if (!ICONS.has(group.icon)) throw new Error("Unknown FAQ section icon.");
    if (!Array.isArray(group.items) || group.items.length < 1 || group.items.length > 30) {
      throw new Error("Each FAQ section must contain between 1 and 30 questions.");
    }
    const items = group.items.map((item, itemIndex) => {
      itemCount += 1;
      const id = cleanText(item?.id, `Question ${itemIndex + 1} ID`, 80);
      if (!/^[a-z0-9-]+$/.test(id) || itemIds.has(id)) {
        throw new Error("Every FAQ question needs a unique simple ID.");
      }
      itemIds.add(id);
      return {
        id,
        question: cleanText(item.question, `Question ${itemIndex + 1}`, 240),
        answer: cleanText(item.answer, `Answer ${itemIndex + 1}`, 5000),
      };
    });
    return {
      key,
      title: cleanText(group.title, `Section ${groupIndex + 1} title`, 120),
      shortTitle: cleanText(group.shortTitle, `Section ${groupIndex + 1} short title`, 60),
      icon: group.icon,
      items,
    };
  });
  if (itemCount > 100) throw new Error("FAQ content cannot exceed 100 questions.");
  return { hero, groups };
}

function ownerOnly(req, res, next) {
  if (req.user.role_id !== 1) {
    return res.status(403).send({ message: "Owner access is required." });
  }
  next();
}

router.get("/", async (req, res) => {
  const page = await getFaq2Page();
  if (!page) return res.status(404).send({ message: "FAQ2 content is not available." });
  res.set("Cache-Control", "no-store");
  res.send({ content: page.content, revision: page.revision, updatedAt: page.updated_at });
});

router.patch("/", requireUser, ownerOnly, async (req, res) => {
  const revision = Number(req.body?.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    return res.status(400).send({ message: "A valid FAQ revision is required." });
  }
  let content;
  try {
    content = validateContent(req.body?.content);
  } catch (error) {
    return res.status(400).send({ message: error.message });
  }
  const page = await updateFaq2Page({ content, revision, updatedBy: req.user.user_id });
  if (!page) {
    return res.status(409).send({ message: "FAQ2 changed in another tab. Reload before saving again." });
  }
  res.send({ content: page.content, revision: page.revision, updatedAt: page.updated_at });
});

export default router;
