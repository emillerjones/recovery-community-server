import crypto from "node:crypto";

const TOKEN_SECRET = process.env.JWT_SECRET;

/** Creates the secret placed in a link/code and the one-way value stored in PostgreSQL. */
export function createSecureToken(bytes = 32) {
  const token = crypto.randomBytes(bytes).toString("base64url");
  return { token, tokenHash: hashSecret(token) };
}

/** HMAC lets us find a submitted token without ever storing the usable secret. */
export function hashSecret(value) {
  if (!TOKEN_SECRET) throw new Error("JWT_SECRET is required to hash registration secrets.");
  return crypto.createHmac("sha256", TOKEN_SECRET).update(String(value)).digest("hex");
}

export function createReadableCode() {
  return crypto.randomBytes(6).toString("hex").toUpperCase();
}
