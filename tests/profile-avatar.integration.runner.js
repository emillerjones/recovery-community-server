// Keep the isolated schema and every helper query on one rollback-only connection.
process.env.DB_CLIENT_MODE = "single";

await import("./profile-avatar.integration.js");
