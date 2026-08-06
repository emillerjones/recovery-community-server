// Use one PostgreSQL connection so the final rollback removes the test schema.
process.env.DB_CLIENT_MODE = "single";

await import("./pending-membership-notifications.integration.js");
