import pg from "pg";
import "dotenv/config";
const db = new pg.Client(process.env.DATABASE_URL);
export default db;
