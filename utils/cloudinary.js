import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

function assertConfigured() {
  const missing = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]
    .filter((key) => !process.env[key]);
  if (missing.length) {
    const error = new Error("Photo storage is not configured.");
    error.status = 503;
    throw error;
  }
}

export function uploadProtectedImage(buffer) {
  assertConfigured();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      resource_type: "image",
      type: "authenticated",
      public_id: `recovery-community/forum/${randomUUID()}`,
      overwrite: false,
    }, (error, result) => error ? reject(error) : resolve(result));
    stream.end(buffer);
  });
}

export function protectedImageUrl(publicId, { variant = "full" } = {}) {
  assertConfigured();
  return cloudinary.url(publicId, {
    resource_type: "image",
    type: "authenticated",
    sign_url: true,
    secure: true,
    transformation: variant === "avatar"
      ? [{ width: 192, height: 192, crop: "fill", gravity: "center", quality: "auto", fetch_format: "auto" }]
      : variant === "thumbnail"
        ? [{ width: 900, height: 900, crop: "limit", quality: "auto", fetch_format: "auto" }]
        : [{ quality: "auto", fetch_format: "auto" }],
  });
}

export async function deleteProtectedImage(publicId) {
  assertConfigured();
  return cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
    type: "authenticated",
    invalidate: true,
  });
}
