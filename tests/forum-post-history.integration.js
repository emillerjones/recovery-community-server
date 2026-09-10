import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import express from "express";

process.env.DB_CLIENT_MODE = "single";
const { default: db } = await import("../db/client.js");
const { default: forum } = await import("../api/forum.js");
const schema = `test_post_history_${randomUUID().replaceAll("-", "")}`;
let server;
await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`SET LOCAL search_path TO ${schema}`);
  await db.query(await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
  await db.query("INSERT INTO user_roles (role_id, role_name) VALUES (1,'Owner'),(10,'Admin'),(50,'Moderator'),(100,'Member')");
  await db.query("INSERT INTO users(role_id,email,password,username,is_system) VALUES(50,'system@test.invalid','unused','system',TRUE)");
  await db.query("INSERT INTO forum_categories(name,slug) VALUES('Introductions','introductions')");
  const { rows: users } = await db.query(`INSERT INTO users (role_id,email,password,username)
    VALUES (100,'author@test.invalid','unused','author'),(100,'reader@test.invalid','unused','reader'),
           (50,'mod@test.invalid','unused','moderator'),(10,'admin@test.invalid','unused','admin'),
           (1,'owner@test.invalid','unused','owner') RETURNING *`);
  const [author, reader, moderator, admin, owner] = users;
  const { rows: [category] } = await db.query("INSERT INTO forum_categories(name,slug) VALUES ('Test','test') RETURNING *");
  async function makePost(user) {
    const { rows: [post] } = await db.query("INSERT INTO posts(category_id,author_id,title,body) VALUES($1,$2,'Original title','Original body') RETURNING *", [category.category_id,user.user_id]);
    return post;
  }
  const post = await makePost(author);
  const { rows: [comment] } = await db.query("INSERT INTO comments(post_id,author_id,body) VALUES($1,$2,'Existing reply') RETURNING *", [post.post_id,reader.user_id]);

  // Test-only identity injection; the real router still runs requireUser.
  const app = express();
  app.use(express.json());
  app.use((req,res,next) => { req.user = users.find(u => String(u.user_id) === req.headers['x-test-user']); next(); });
  app.use('/api/forum', forum);
  server = await new Promise(resolve => { const listener = app.listen(0,'127.0.0.1',()=>resolve(listener)); });
  async function request(user, path, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/forum${path}`, {
      method, headers: { ...(user ? { 'x-test-user': String(user.user_id) } : {}), 'Content-Type':'application/json' },
      ...(body ? { body:JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return { status:response.status, data:text ? (()=>{try{return JSON.parse(text);}catch{return text;}})() : null };
  }
  const path = `/posts/${post.post_id}`;
  assert.equal((await request(null,`${path}/history`)).status,401);
  assert.equal((await request(null,path,'PATCH',{body:'Denied'})).status,401);
  assert.deepEqual((await request(reader,`${path}/history`)).data,[]);
  for (const actor of [reader,moderator,admin]) assert.equal((await request(actor,path,'PATCH',{body:'Denied'})).status,404);
  assert.equal((await request(author,path,'PATCH',{title:'Changed title',body:'Changed body'})).status,200);
  assert.equal((await request(owner,path,'PATCH',{body:'Owner correction'})).status,200);
  const history = (await request(reader,`${path}/history`)).data;
  assert.equal(history.length,2);
  assert.deepEqual(history.map(r=>[r.previous_title,r.previous_body,r.editor_username]),[
    ['Changed title','Changed body','owner'],['Original title','Original body','author'],
  ]);
  assert.ok(history.every(r=>r.created_at));
  assert.equal((await request(owner,path,'PATCH',{body:'Owner correction'})).status,404);
  assert.equal((await request(reader,`${path}/history`)).data.length,2);
  for (const actor of [moderator,admin]) {
    const own = await makePost(actor);
    assert.equal((await request(actor,`/posts/${own.post_id}`,'PATCH',{body:'Self correction'})).status,200);
  }
  assert.equal((await request(reader,`${path}/comments/${comment.comment_id}`,'PATCH',{body:'Changed reply'})).status,403);
  assert.equal((await db.query('SELECT body FROM comments WHERE comment_id=$1',[comment.comment_id])).rows[0].body,'Existing reply');
  reader.account_status='pending';
  assert.equal((await request(reader,`${path}/history`)).status,403);
  reader.account_status='approved'; reader.active=false;
  assert.equal((await request(reader,`${path}/history`)).status,403);
  reader.active=true;
  await db.query('UPDATE posts SET active=FALSE WHERE post_id=$1',[post.post_id]);
  assert.equal((await request(reader,`${path}/history`)).status,404);
  assert.equal((await request(author,path,'PATCH',{body:'Hidden edit'})).status,404);
  await db.query('UPDATE posts SET active=TRUE,deleted_at=NOW() WHERE post_id=$1',[post.post_id]);
  assert.equal((await request(reader,`${path}/history`)).status,404);
  assert.equal((await request(reader,'/posts/999999/history')).status,404);
  assert.equal((await request(reader,'/posts/nope/history')).status,400);
  console.log('PASS: own-post edits, owner override, immutable snapshots, reader access, denied access, unchanged replies and comment permissions.');
} finally {
  if (server) await new Promise(resolve=>server.close(resolve));
  await db.query('ROLLBACK');
  await db.end();
}
