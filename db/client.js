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

let savepointCounter = 0;

// Production uses a Pool, so a transaction must reserve one connection for
// its entire lifetime. Integration tests already wrap their single Client in
// a transaction, so they can safely reuse it directly.
export async function withTransaction(work) {
  if (useSingleClient) {
    const savepoint = `nested_transaction_${++savepointCounter}`;
    await db.query(`SAVEPOINT ${savepoint}`);
    try {
      const result = await work(db);
      await db.query(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await db.query(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
