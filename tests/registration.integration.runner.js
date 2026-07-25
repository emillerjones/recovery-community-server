// Production uses a resilient connection pool. This test is the one exception:
// it needs every helper query on the same connection so its final ROLLBACK can
// cleanly remove the temporary schema and all test data.
process.env.DB_CLIENT_MODE = "single";

await import("./registration.integration.js");
