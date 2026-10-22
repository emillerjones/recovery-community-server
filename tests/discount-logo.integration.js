import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import express from "express";
import sharp from "sharp";
import { v2 as cloudinary } from "cloudinary";

process.env.DB_CLIENT_MODE = "single";
const { default: db } = await import("../db/client.js");
const { default: router } = await import("../api/discount2.js");
const { uploadProtectedImage } = await import("../utils/cloudinary.js");
const schema = `test_discount_logos_${randomUUID().replaceAll("-", "")}`;
const originalUpload = cloudinary.uploader.upload_stream;
const stored = [];
let failStorage = false;
cloudinary.uploader.upload_stream = (options, callback) => {
  const chunks = [];
  return new Writable({
    write(chunk, encoding, done) { chunks.push(chunk); done(); },
    final(done) {
      if (failStorage) callback(new Error("Simulated storage failure"));
      else {
        stored.push({ options, buffer: Buffer.concat(chunks) });
        callback(null, { public_id: options.public_id, secure_url: `https://res.cloudinary.com/test/image/upload/${options.public_id}.webp` });
      }
      done();
    },
  });
};
let server;
await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`SET LOCAL search_path TO ${schema}`);
  await db.query(`CREATE TABLE discount_pages(page_key TEXT PRIMARY KEY, content JSONB NOT NULL,
    revision INT NOT NULL DEFAULT 1, updated_by INT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`);
  const content = {
    hero: { eyebrow: "Discounts", title: "Community brands", intro: "Support our community." },
    categories: [{ id: "brands", title: "Brands", description: "Recommended brands", icon: "package", brands: [
      { id: "one", name: "Brand one", code: null, url: "https://example.com", logo: "https://example.com/old.png", note: null, active: true },
    ] }],
    guide: { eyebrow: "Guide", title: "How to save", intro: "Use a code", highlights: ["Save"], updated: "Check offers", directions: ["Visit the store"], notes: ["Terms apply"], contactText: "Contact us", contactEmail: "owner@example.com" },
    disclaimer: "Offers can change.",
  };
  await db.query("INSERT INTO discount_pages(page_key,content) VALUES('discountlinks2',$1)", [content]);
  const app = express(); app.use(express.json());
  app.use((req, res, next) => {
    const role = Number(req.headers["x-test-role"]);
    if (role) req.user = { user_id: role, role_id: role, account_status: "approved", active: true, email_verified_at: new Date() };
    next();
  });
  app.use(router);
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const png = await sharp({ create: { width: 1400, height: 700, channels: 4, background: { r: 40, g: 70, b: 50, alpha: .5 } } }).png().withMetadata().toBuffer();
  async function upload(role, buffer = png, filename = "logo.png", duplicate = false) {
    const form = new FormData(); form.append("image", new Blob([buffer]), filename);
    if (duplicate) form.append("image", new Blob([buffer]), filename);
    return fetch(endpoint + "/logos", { method: "POST", headers: role ? { "x-test-role": String(role) } : {}, body: form });
  }
  assert.equal((await upload(null)).status, 401);
  for (const role of [10, 50, 100]) assert.equal((await upload(role)).status, 403);
  assert.equal(stored.length, 0);
  for (const [bytes, filename, expected] of [
    [Buffer.from("not an image"), "fake.png", 400],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'), "logo.svg", 400],
    [Buffer.alloc(5 * 1024 * 1024 + 1), "big.png", 413],
    [Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"), "animated.gif", 400],
  ]) assert.equal((await upload(1, bytes, filename)).status, expected);
  assert.equal((await upload(1, png, "one.png", true)).status, 400);
  const missing = await fetch(endpoint + "/logos", { method: "POST", headers: { "x-test-role": "1" }, body: new FormData() });
  assert.equal(missing.status, 400);
  const response = await upload(1); assert.equal(response.status, 201);
  const { url } = await response.json(); assert.ok(url.startsWith("https://"));
  assert.equal(stored[0].options.type, "upload");
  assert.ok(stored[0].options.public_id.startsWith("recovery-community/discount-logos/"));
  assert.equal(stored[0].options.overwrite, false);
  const normalized = await sharp(stored[0].buffer).metadata();
  assert.equal(normalized.width, 512); assert.equal(normalized.height, 256);
  assert.equal(normalized.format, "webp"); assert.equal(normalized.hasAlpha, true);
  assert.equal(normalized.exif, undefined);
  let page = await (await fetch(endpoint)).json();
  assert.equal(page.content.categories[0].brands[0].logo, content.categories[0].brands[0].logo, "Uploading cannot change the public page");
  const next = structuredClone(content); next.categories[0].brands[0].logo = url;
  const patch = (body) => fetch(endpoint, { method: "PATCH", headers: { "x-test-role": "1", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await patch({ content: next, revision: 1 })).status, 200);
  assert.equal((await patch({ content, revision: 1 })).status, 409);
  page = await (await fetch(endpoint)).json(); assert.equal(page.content.categories[0].brands[0].logo, url);
  next.categories[0].brands[0].logo = null;
  assert.equal((await patch({ content: next, revision: 2 })).status, 200);
  next.categories[0].brands[0].logo = "https://example.com/external.png";
  assert.equal((await patch({ content: next, revision: 3 })).status, 200);
  failStorage = true; assert.equal((await upload(1)).status, 502); failStorage = false;
  page = await (await fetch(endpoint)).json(); assert.equal(page.revision, 4);
  assert.equal(page.content.categories[0].brands[0].logo, "https://example.com/external.png");
  await uploadProtectedImage(png);
  assert.equal(stored.at(-1).options.type, "authenticated", "Community photos remain protected");
  const read = async () => (await (await fetch(endpoint)).json());
  const item = async (edit, role = 1, revisionOverride) => fetch(endpoint + "/items", {
    method: "PATCH", headers: { ...(role ? { "x-test-role": String(role) } : {}), "Content-Type": "application/json" },
    body: JSON.stringify({ ...edit, revision: revisionOverride ?? (await read()).revision }),
  });
  const originalExtras = (await read()).content;
  const originalBrand = originalExtras.categories[0].brands[0];
  for (const role of [null, 10, 50, 100]) assert.equal((await item({ action: "delete-brand", categoryId: "brands", brandId: "one" }, role)).status, role ? 403 : 401);
  const isolatedBrand = { ...originalBrand, note: "Only this brand changed" };
  assert.equal((await item({ action: "save-brand", categoryId: "brands", brand: isolatedBrand, content: { disclaimer: "Must be ignored" } })).status, 200);
  let scoped = (await read()).content;
  assert.deepEqual(scoped.categories[0].brands[0], isolatedBrand);
  assert.equal(scoped.categories[0].title, originalExtras.categories[0].title);
  const metadata = { title: "Updated category", description: "Saved details", icon: "leaf", brands: [{ id: "must-not-save" }] };
  assert.equal((await item({ action: "save-category", categoryId: "brands", category: metadata })).status, 200);
  scoped = (await read()).content;
  assert.deepEqual(scoped.categories[0].brands, [isolatedBrand], "Saving category details cannot publish brand drafts");
  const secondBrand = { ...originalBrand, id: "two", name: "Second brand", logo: null };
  assert.equal((await item({ action: "save-brand", categoryId: "brands", brand: secondBrand })).status, 200);
  assert.equal((await item({ action: "save-category", categoryId: "second", category: metadata })).status, 200);
  assert.deepEqual((await read()).content.categories[1].brands, [], "New categories start with no published brand drafts");
  assert.equal((await item({ action: "reorder-brands", categoryId: "brands", ids: ["two", "one"] })).status, 200);
  assert.equal((await item({ action: "reorder-categories", ids: ["second", "brands"] })).status, 200);
  scoped = (await read()).content;
  assert.deepEqual(scoped.categories.map(category => category.id), ["second", "brands"]);
  assert.deepEqual(scoped.categories[1].brands, [secondBrand, isolatedBrand]);
  assert.deepEqual(scoped.hero, originalExtras.hero); assert.deepEqual(scoped.guide, originalExtras.guide); assert.equal(scoped.disclaimer, originalExtras.disclaimer);
  const beforeInvalid = await read();
  for (const edit of [
    { action: "reorder-categories", ids: ["second", "second"] },
    { action: "reorder-categories", ids: ["brands"] },
    { action: "reorder-brands", categoryId: "brands", ids: ["two", "invented"] },
    { action: "save-brand", categoryId: "brands", brand: { ...isolatedBrand, url: "javascript:alert(1)" } },
    { action: "save-category", categoryId: "brands", category: { ...metadata, title: "" } },
    { action: "unknown", categoryId: "brands" },
  ]) assert.equal((await item(edit)).status, 400);
  assert.equal((await item({ action: "save-brand", categoryId: "missing", brand: isolatedBrand })).status, 404);
  assert.deepEqual(await read(), beforeInvalid, "Rejected actions cannot alter content/revision");
  const oldRevision = beforeInvalid.revision;
  assert.equal((await item({ action: "delete-brand", categoryId: "brands", brandId: "two" })).status, 200);
  assert.equal((await item({ action: "delete-category", categoryId: "second" }, 1, oldRevision)).status, 409);
  assert.equal((await item({ action: "delete-category", categoryId: "second" })).status, 200);
  assert.equal((await item({ action: "delete-category", categoryId: "brands" })).status, 400);
  console.log("PASS: scoped brand/category saves, new items, immediate ordering/deletion, preserved unrelated fields, Owner-only access, validation, stale revisions and last-category protection.");
  console.log("PASS: Owner-only logo upload, actual image validation, limits, resize/transparency/metadata, public URL, publish-only changes, links/removal/conflicts/failures, protected photos unchanged.");
} finally {
  cloudinary.uploader.upload_stream = originalUpload;
  if (server) await new Promise(resolve => server.close(resolve));
  await db.query("ROLLBACK"); await db.end();
}
