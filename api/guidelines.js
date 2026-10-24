import express from "express";
import requireUser from "#middleware/requireUser";
import { getGuidelinesPage, updateGuidelinesPage } from "#db/queries/guidelines";
import { GUIDELINES_ICONS, GUIDELINES_PAGE_FIELDS } from "#utils/guidelinesContent";
import { applyGuidelinesEdit, validateGuidelines } from "#utils/guidelinesEdits";

const router = express.Router();
router.get("/", async (req, res) => {
  const page = await getGuidelinesPage();
  if (!page) return res.status(404).send({ message: "Guidelines content is not available." });
  res.set("Cache-Control", "no-store");
  res.send({ content: page.content, revision: page.revision, pageFields: GUIDELINES_PAGE_FIELDS, icons: GUIDELINES_ICONS });
});
router.patch("/items", requireUser, async (req, res) => {
  if (req.user.role_id !== 1) return res.status(403).send({ message: "Owner access is required." });
  const revision = req.body?.revision;
  if (!Number.isSafeInteger(revision) || revision < 1) return res.status(400).send({ message: "A valid saved revision is required." });
  const saved = await getGuidelinesPage();
  if (!saved) return res.status(404).send({ message: "Guidelines content is not available." });
  const conflict = "Guidelines changed in another tab. Reload before saving again. Your unfinished edits are still here.";
  if (revision !== saved.revision) return res.status(409).send({ message: conflict });
  let content;
  try { content = validateGuidelines(applyGuidelinesEdit(saved.content, req.body)); }
  catch (error) { return res.status(error.status || 400).send({ message: error.message }); }
  const page = await updateGuidelinesPage({ content, revision, updatedBy: req.user.user_id });
  if (!page) return res.status(409).send({ message: conflict });
  res.send({ content: page.content, revision: page.revision });
});
export default router;
