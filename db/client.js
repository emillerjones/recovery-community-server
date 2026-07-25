import pg from "pg";
import "dotenv/config";

// The running server uses a pool so one dropped PostgreSQL connection does
// not take the entire application down. A later query can borrow a healthy
// connection or open a replacement automatically.
//
// The integration-test runner deliberately requests one Client because that
// test wraps every query in a single transaction and rolls it all back.
const useSingleClient = process.env.DB_CLIENT_MODE === "single";
const db = useSingleClient
  ? new pg.Client(process.env.DATABASE_URL)
  : new pg.Pool({ connectionString: process.env.DATABASE_URL });

if (!useSingleClient) {
  // Pools can discover a dead connection while it is sitting idle. Listening
  // for that event keeps it from becoming an unhandled EventEmitter error;
  // node-postgres removes that client and future queries can keep working.
  db.on("error", (error) => {
    console.error("Unexpected idle PostgreSQL connection error:", error);
  });
}

export default db;
