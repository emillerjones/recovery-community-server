import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
process.env.DB_CLIENT_MODE = "single";
const { default: db } = await import("../db/client.js");
const schema = `test_like_${randomUUID().replaceAll("-", "")}`;
const run = async (path) => db.query((await fs.readFile(new URL(path, import.meta.url), "utf8"))
  .replace(/^BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, ""));
await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`SET LOCAL search_path TO ${schema}`);
  // Reproduce the currently configured database's allowed types, including
  // encouragement, without touching any existing application tables.
  await db.query(`CREATE TABLE forum_reactions (
    reaction_id SERIAL PRIMARY KEY, user_id INT, post_id INT, comment_id INT,
    reaction_type TEXT NOT NULL CONSTRAINT forum_reactions_reaction_type_check
      CHECK (reaction_type IN ('support','agree','relate','encouragement','helpful','celebrate','inspiring','care')),
    created_at TIMESTAMP DEFAULT '2026-01-01', updated_at TIMESTAMP DEFAULT '2026-02-01'
  )`);
  await db.query(`INSERT INTO forum_reactions(user_id,post_id,comment_id,reaction_type) VALUES
    (1,10,NULL,'agree'),(2,NULL,20,'agree'),(3,10,NULL,'encouragement'),(4,10,NULL,'support')`);
  const before=(await db.query('SELECT * FROM forum_reactions ORDER BY reaction_id')).rows;
  await run('../db/migrations/025_prepare_like_reaction.sql');
  await run('../db/migrations/025_prepare_like_reaction.sql');
  assert.deepEqual((await db.query('SELECT * FROM forum_reactions ORDER BY reaction_id')).rows,before);
  await run('../db/migrations/026_rename_agree_to_like.sql');
  await run('../db/migrations/026_rename_agree_to_like.sql');
  assert.deepEqual((await db.query('SELECT * FROM forum_reactions ORDER BY reaction_id')).rows,
    before.map(row=>({...row,reaction_type:row.reaction_type==='agree'?'like':row.reaction_type})));
  const constraint=(await db.query("SELECT pg_get_constraintdef(oid) AS rule FROM pg_constraint WHERE conrelid='forum_reactions'::regclass AND conname='forum_reactions_reaction_type_check'")).rows[0].rule;
  assert.doesNotMatch(constraint,/'agree'/); assert.match(constraint,/'like'/); assert.match(constraint,/'encouragement'/);
  await run('../db/rollbacks/026_restore_agree_reaction.sql');
  assert.deepEqual((await db.query('SELECT * FROM forum_reactions ORDER BY reaction_id')).rows,before);
  await run('../db/migrations/025_prepare_like_reaction.sql');
  await run('../db/migrations/026_rename_agree_to_like.sql');
  console.log('PASS: expand, rename, repeat, rollback, reapply; IDs/users/targets/timestamps and other types preserved.');
} finally { await db.query('ROLLBACK'); await db.end(); }
