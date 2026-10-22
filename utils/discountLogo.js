import sharp from "sharp";

const FORMATS = new Set(["jpeg", "png", "webp", "heif", "avif"]);

export async function prepareDiscountLogo(buffer) {
  const image = sharp(buffer, { failOn: "error", limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  if (!FORMATS.has(metadata.format) || (metadata.pages || 1) > 1) {
    throw new Error("Use a JPG, PNG, WebP, HEIC, or AVIF image. Animated images and SVGs are not supported.");
  }
  // Preserve the whole logo and transparency, stripping metadata without
  // cropping it or stretching a small source image.
  return image.rotate()
    .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
    .webp({ lossless: true })
    .toBuffer();
}
