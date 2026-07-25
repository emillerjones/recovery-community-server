// Seed work is a short, one-off operation. Keep its existing explicit
// connect/end lifecycle while the long-running web server uses a pool.
process.env.DB_CLIENT_MODE = "single";

await import("./seed.js");
