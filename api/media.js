import { Readable } from "node:stream";
import express from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import sharp from "sharp";
import requireUser from "#middleware/requireUser";
import {
  createPendingMedia,
  deletePendingMedia,
  expireAbandonedMedia,
  getViewableMedia,
  restorePendingMedia,
} from "#db/queries/media";
import {
  deleteProtectedImage,
  protectedImageUrl,
  uploadProtectedImage,
} from "#utils/cloudinary";

const router = express.Router();
router.use(requireUser);

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "heif", "avif"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});
const uploadLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

async function cleanAbandonedUploads() {
  const expired = await expireAbandonedMedia();
  await Promise.allSettled(expired.map((media) => (
    deleteProtectedImage(media.provider_asset_id)
  )));
}

function receiveImage(req, res) {
  return new Promise((resolve, reject) => {
    upload.single("image")(req, res, (error) => error ? reject(error) : resolve());
  });
}

router.post("/images", uploadLimiter, async (req, res) => {
  try {
    await receiveImage(req, res);
    if (!req.file) return res.status(400).send({ message: "Choose a photo to upload." });

    const source = sharp(req.file.buffer, {
      failOn: "error",
      limitInputPixels: 40_000_000,
    });
    const metadata = await source.metadata();
    if (!ALLOWED_FORMATS.has(metadata.format) || (metadata.pages || 1) > 1) {
      return res.status(400).send({ message: "Use a JPG, PNG, WebP, HEIC, or AVIF photo." });
    }

    // Re-encoding fixes phone orientation, caps dimensions, and strips EXIF
    // metadata such as GPS coordinates before the file leaves our server.
    const { data, info } = await source
      .rotate()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    const stored = await uploadProtectedImage(data);
    try {
      const media = await createPendingMedia({
        uploadedBy: req.user.user_id,
        providerAssetId: stored.public_id,
        format: info.format,
        byteSize: info.size,
        width: info.width,
        height: info.height,
      });
      res.status(201).send(media);
      cleanAbandonedUploads().catch((error) => (
        console.error("Could not clean abandoned photo uploads:", error)
      ));
    } catch (error) {
      await deleteProtectedImage(stored.public_id).catch(() => {});
      throw error;
    }
  } catch (error) {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).send({ message: "Photos must be 5 MB or smaller." });
    }
    if (error instanceof multer.MulterError) {
      return res.status(400).send({ message: "That photo could not be uploaded." });
    }
    if (error.status) return res.status(error.status).send({ message: error.message });
    console.error("Photo upload failed:", error);
    res.status(400).send({ message: "That file is not a supported photo." });
  }
});

router.get("/images/:id/content", async (req, res) => {
  const mediaId = Number(req.params.id);
  if (!Number.isSafeInteger(mediaId) || mediaId <= 0) {
    return res.status(400).send({ message: "Invalid photo." });
  }

  const media = await getViewableMedia(mediaId, req.user.user_id);
  if (!media) return res.status(404).send({ message: "Photo not found." });

  const sourceUrl = protectedImageUrl(media.provider_asset_id, {
    thumbnail: req.query.variant === "thumbnail",
  });
  const upstream = await fetch(sourceUrl);
  if (!upstream.ok || !upstream.body) {
    return res.status(502).send({ message: "Photo is temporarily unavailable." });
  }

  res.set("Content-Type", upstream.headers.get("content-type") || "image/webp");
  res.set("Cache-Control", "private, max-age=300");
  Readable.fromWeb(upstream.body).pipe(res);
});

router.delete("/images/:id", async (req, res) => {
  const mediaId = Number(req.params.id);
  if (!Number.isSafeInteger(mediaId) || mediaId <= 0) {
    return res.status(400).send({ message: "Invalid photo." });
  }

  const media = await deletePendingMedia(mediaId, req.user.user_id);
  if (!media) return res.status(404).send({ message: "Pending photo not found." });
  try {
    await deleteProtectedImage(media.provider_asset_id);
    res.send({ deleted: true });
  } catch (error) {
    await restorePendingMedia(mediaId, req.user.user_id);
    console.error("Could not remove pending Cloudinary photo:", error);
    res.status(502).send({ message: "Could not remove that photo yet." });
  }
});

export default router;
