import express from "express";
import requireUser from "#middleware/requireUser";
import { getResourcesPage, updateResourcesPage } from "#db/queries/resources";
import { applyResourceEdit } from "#utils/resourceEdits";

const router = express.Router();

function text(value, label, max, optional = false) {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const cleaned = value.trim();
  if ((!optional && !cleaned) || cleaned.length > max) throw new Error(`${label} must contain ${optional ? '0' : '1'} to ${max} characters.`);
  return cleaned;
}

function validateContent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Resources content is required.");
  if (!Array.isArray(input.categories) || input.categories.length > 20) throw new Error("Use up to 20 resource categories.");
  const categoryIds = new Set();
  const linkIds = new Set();
  let linkCount = 0;
  function uniqueId(value, ids, label) {
    const id = text(value, label, 80);
    if (!/^[a-z0-9-]+$/.test(id) || ids.has(id)) throw new Error(`${label} must be unique and use only lowercase letters, numbers, and dashes.`);
    ids.add(id);
    return id;
  }
  const categories = input.categories.map((group) => {
    const id = uniqueId(group?.id, categoryIds, "Category ID");
    if (!["learn", "support"].includes(group.section)) throw new Error("Choose Learn or Find Support for every category.");
    if (!Array.isArray(group.links) || group.links.length > 60) throw new Error("Each category can contain up to 60 resources.");
    return {
      id,
      title: text(group.title, "Category title", 140),
      section: group.section,
      links: group.links.map((link) => {
        linkCount += 1;
        const linkId = uniqueId(link?.id, linkIds, "Resource ID");
        const url = text(link.url, "Resource address", 2000);
        let parsed;
        try { parsed = new URL(url); } catch { throw new Error("Every resource needs a valid web address."); }
        if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Resource addresses must use http:// or https:// without embedded credentials.");
        return { id: linkId, text: text(link.text, "Resource title", 500), url, tag: text(link.tag ?? "", "Resource label", 60, true) };
      }),
    };
  });
  if (linkCount > 300) throw new Error("Use up to 300 resources in total.");
  return {
    hero: {
      kicker: text(input.hero?.kicker, "Small heading", 120),
      title: text(input.hero?.title, "Page title", 180),
      intro: text(input.hero?.intro, "Introduction", 800),
    },
    learnIntro: text(input.learnIntro, "Learn introduction", 1200),
    supportIntro: text(input.supportIntro, "Find Support introduction", 1200),
    categories,
  };
}

router.get("/", async (req, res) => {
  const page = await getResourcesPage();
  if (!page) return res.status(404).send({ message: "Resources content is not available." });
  res.set("Cache-Control", "no-store");
  res.send({ content: page.content, revision: page.revision, updatedAt: page.updated_at });
});

router.patch("/", requireUser, async (req, res) => {
  if (req.user.role_id !== 1) return res.status(403).send({ message: "Owner access is required." });
  const revision = req.body?.revision;
  if (!Number.isSafeInteger(revision) || revision < 1) return res.status(400).send({ message: "A valid saved revision is required." });
  let content;
  try { content = validateContent(req.body?.content); }
  catch (error) { return res.status(400).send({ message: error.message }); }
  const page = await updateResourcesPage({ content, revision, updatedBy: req.user.user_id });
  if (!page) return res.status(409).send({ message: "Resources changed in another tab. Your draft is still here. Reload before saving again." });
  res.send({ content: page.content, revision: page.revision, updatedAt: page.updated_at });
});

router.patch("/items", requireUser, async (req, res) => {
  if (req.user.role_id !== 1) return res.status(403).send({ message: "Owner access is required." });
  const revision = req.body?.revision;
  if (!Number.isSafeInteger(revision) || revision < 1) return res.status(400).send({ message: "A valid saved revision is required." });
  const saved = await getResourcesPage();
  if (!saved) return res.status(404).send({ message: "Resources content is not available." });
  const conflict = "Resources changed in another tab. Reload before saving again. Your unfinished edits are still here.";
  if (saved.revision !== revision) return res.status(409).send({ message: conflict });
  let content;
  try { content = validateContent(applyResourceEdit(saved.content, req.body)); }
  catch (error) { return res.status(error.status || 400).send({ message: error.message }); }
  const page = await updateResourcesPage({ content, revision, updatedBy: req.user.user_id });
  if (!page) return res.status(409).send({ message: conflict });
  res.send({ content: page.content, revision: page.revision, updatedAt: page.updated_at });
});

export default router;
