import express from "express";
import requireUser from "#middleware/requireUser";
import { getOurStoryPage, updateOurStoryPage } from "#db/queries/ourStory";
import { OUR_STORY_SECTIONS } from "#utils/ourStoryContent";

const router = express.Router();

router.get("/", async (req, res) => {
  const page = await getOurStoryPage();
  if (!page) return res.status(404).send({ message: "Our Story content is not available." });
  res.set({ "Cache-Control": "no-store" });
  res.send({ content: page.content, revision: page.revision, sections: OUR_STORY_SECTIONS });
});

router.patch("/sections/:sectionId", requireUser, async (req, res) => {
  if (req.user.role_id !== 1) return res.status(403).send({ message: "Owner access is required." });
  const section = OUR_STORY_SECTIONS.find(item => item.id === req.params.sectionId);
  if (!section) return res.status(400).send({ message: "Choose an existing Our Story section." });
  const revision = req.body?.revision;
  if (!Number.isSafeInteger(revision) || revision < 1) return res.status(400).send({ message: "A valid saved revision is required." });
  const input = req.body?.fields;
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== section.fields.length
    || Object.keys(input).some(key => !section.fields.some(field => field.key === key))) {
    return res.status(400).send({ message: "Send only the text fields for this section. Button labels, links, and layout cannot be edited here." });
  }
  const fields = {};
  for (const field of section.fields) {
    const value = input[field.key];
    if (typeof value !== "string" || !value.trim() || value.trim().length > field.maxLength) {
      return res.status(400).send({ message: `${field.label} must contain 1 to ${field.maxLength} characters.` });
    }
    fields[field.key] = value.trim();
  }
  const saved = await getOurStoryPage();
  if (!saved) return res.status(404).send({ message: "Our Story content is not available." });
  const conflict = "Our Story changed in another tab. Reload before saving again. Your unfinished edits are still here.";
  if (saved.revision !== revision) return res.status(409).send({ message: conflict });
  // Only this section changes. Ignore unrelated drafts or content in the request.
  const content = { ...saved.content, [section.id]: fields };
  const page = await updateOurStoryPage({ content, revision, updatedBy: req.user.user_id });
  if (!page) return res.status(409).send({ message: conflict });
  res.send({ content: page.content, revision: page.revision });
});

export default router;
