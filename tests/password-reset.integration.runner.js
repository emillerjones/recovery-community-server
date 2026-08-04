// Keep every test query on one connection so the final ROLLBACK removes the
// temporary schema and all password-reset test data.
process.env.DB_CLIENT_MODE = "single";

await import("./password-reset.integration.js");
