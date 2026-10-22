// Keep the isolated schema and every test write on one rollback-only connection.
process.env.DB_CLIENT_MODE = "single";

await import("./direct-message-paging.integration.js");
