import express from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import requireUser from "#middleware/requireUser";
import { getDiscount2Page, updateDiscount2Page } from "#db/queries/discount2";
import { prepareDiscountLogo } from "#utils/discountLogo";
import { uploadDiscountLogo } from "#utils/cloudinary";

const router = express.Router();
const ICONS = new Set(["shirt", "leaf", "cable", "package", "candy"]);

function cleanText(value, label, maxLength) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const text = value.trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maxLength) throw new Error(`${label} is too long.`);
  return text;
}

function cleanOptionalText(value, label, maxLength) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const text = value.trim();
  if (text.length > maxLength) throw new Error(`${label} is too long.`);
  return text || null;
}

function cleanUrl(value, label, required = true) {
  const text = required ? cleanText(value, label, 2000) : cleanOptionalText(value, label, 2000);
  if (!text) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${label} must be a valid web address.`);
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error(`${label} must start with http:// or https://.`);
  }
  return url.toString();
}

function cleanEmail(value) {
  const email = cleanText(value, "Contact email", 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Contact email must be a valid email address.");
  }
  return email;
}

function cleanList(value, label, maxItems, maxLength) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
    throw new Error(`${label} must contain between 1 and ${maxItems} items.`);
  }
  return value.map((item, index) => cleanText(item, `${label} item ${index + 1}`, maxLength));
}

function validateContent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Discount page content is required.");
  }

  const hero = {
    eyebrow: cleanText(input.hero?.eyebrow, "Hero label", 120),
    title: cleanText(input.hero?.title, "Hero title", 180),
    intro: cleanText(input.hero?.intro, "Hero introduction", 800),
  };

  if (!Array.isArray(input.categories) || input.categories.length < 1 || input.categories.length > 12) {
    throw new Error("Discount content must contain between 1 and 12 categories.");
  }
  const categoryIds = new Set();
  const brandIds = new Set();
  let brandCount = 0;
  const categories = input.categories.map((category, categoryIndex) => {
    const id = cleanText(category?.id, `Category ${categoryIndex + 1} ID`, 80);
    if (!/^[a-z0-9-]+$/.test(id) || categoryIds.has(id)) {
      throw new Error("Every discount category needs a unique simple ID.");
    }
    categoryIds.add(id);
    if (!ICONS.has(category.icon)) throw new Error("Unknown discount category icon.");
    if (!Array.isArray(category.brands) || category.brands.length > 60) {
      throw new Error("Each category can contain up to 60 brands.");
    }
    const brands = category.brands.map((brand, brandIndex) => {
      brandCount += 1;
      const brandId = cleanText(brand?.id, `Brand ${brandIndex + 1} ID`, 80);
      if (!/^[a-z0-9-]+$/.test(brandId) || brandIds.has(brandId)) {
        throw new Error("Every discount brand needs a unique simple ID.");
      }
      brandIds.add(brandId);
      if (typeof brand.active !== "boolean") throw new Error("Every brand needs a visibility setting.");
      return {
        id: brandId,
        name: cleanText(brand.name, `Brand ${brandIndex + 1} name`, 160),
        code: cleanOptionalText(brand.code, `Brand ${brandIndex + 1} code`, 100),
        url: cleanUrl(brand.url, `Brand ${brandIndex + 1} link`),
        logo: cleanUrl(brand.logo, `Brand ${brandIndex + 1} logo`, false),
        note: cleanOptionalText(brand.note, `Brand ${brandIndex + 1} note`, 500),
        active: brand.active,
      };
    });
    return {
      id,
      title: cleanText(category.title, `Category ${categoryIndex + 1} title`, 140),
      description: cleanText(category.description, `Category ${categoryIndex + 1} description`, 500),
      icon: category.icon,
      brands,
    };
  });
  if (brandCount > 200) throw new Error("Discount content cannot exceed 200 brands.");

  const guide = {
    eyebrow: cleanText(input.guide?.eyebrow, "Guide label", 120),
    title: cleanText(input.guide?.title, "Guide title", 180),
    intro: cleanText(input.guide?.intro, "Guide introduction", 1200),
    highlights: cleanList(input.guide?.highlights, "Guide highlights", 6, 500),
    updated: cleanText(input.guide?.updated, "Update reminder", 500),
    directions: cleanList(input.guide?.directions, "Directions", 12, 500),
    notes: cleanList(input.guide?.notes, "Notes", 12, 500),
    contactText: cleanText(input.guide?.contactText, "Contact text", 800),
    contactEmail: cleanEmail(input.guide?.contactEmail),
  };

  return {
    hero,
    categories,
    guide,
    disclaimer: cleanText(input.disclaimer, "Disclaimer", 1200),
  };
}

function ownerOnly(req, res, next) {
  if (req.user.role_id !== 1) return res.status(403).send({ message: "Owner access is required." });
  next();
}

const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const logoUploadLimit = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false });

router.post("/logos", requireUser, ownerOnly, logoUploadLimit, async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      logoUpload.single("image")(req, res, error => error ? reject(error) : resolve());
    });
  } catch (error) {
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).send({
      message: error.code === "LIMIT_FILE_SIZE" ? "Logos must be 5 MB or smaller." : "Choose one logo image to upload.",
    });
  }
  if (!req.file) return res.status(400).send({ message: "Choose a logo image to upload." });
  let image;
  try { image = await prepareDiscountLogo(req.file.buffer); }
  catch { return res.status(400).send({ message: "Use a valid JPG, PNG, WebP, HEIC, or AVIF image, without animation." }); }
  try {
    const stored = await uploadDiscountLogo(image);
    if (typeof stored.secure_url !== "string" || !stored.secure_url.startsWith("https://")) throw new Error("Missing public logo URL");
    res.set("Cache-Control", "no-store");
    res.status(201).send({ url: stored.secure_url });
  } catch (error) {
    console.error("Discount logo upload failed:", error.message);
    res.status(error.status || 502).send({ message: "The logo could not be uploaded. Please try again." });
  }
});

router.get("/", async (req, res) => {
  const page = await getDiscount2Page();
  if (!page) return res.status(404).send({ message: "Discount2 content is not available." });
  res.set("Cache-Control", "no-store");
  res.send({ content: page.content, revision: page.revision, updatedAt: page.updated_at });
});

router.patch("/", requireUser, ownerOnly, async (req, res) => {
  const revision = Number(req.body?.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    return res.status(400).send({ message: "A valid discount-page revision is required." });
  }
  let content;
  try {
    content = validateContent(req.body?.content);
  } catch (error) {
    return res.status(400).send({ message: error.message });
  }
  const page = await updateDiscount2Page({ content, revision, updatedBy: req.user.user_id });
  if (!page) {
    return res.status(409).send({ message: "Discount2 changed in another tab. Reload before saving again." });
  }
  res.send({ content: page.content, revision: page.revision, updatedAt: page.updated_at });
});

export default router;
