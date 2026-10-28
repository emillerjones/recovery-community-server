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

  const path = '/posts/' + post.post_id;
  const commentPath = path + '/comments/' + comment.comment_id;
  assert.equal((await request(null,path+'/flag','POST',{reason:'Reason'})).status,401);
  for (const endpoint of [path+'/flag',commentPath+'/flag']) {
    for (const reason of [undefined,null,42,{},[], '', '   ', 'x'.repeat(1001)]) {
      assert.equal((await request(owner,endpoint,'POST',{reason})).status,400);
    }
  }
  assert.equal((await request(author,path+'/flag','POST',{reason:'Own post'})).status,400);
  assert.equal((await request(reader,commentPath+'/flag','POST',{reason:'Own comment'})).status,400);
  assert.equal((await request(reader,path+'/flag','POST',{reason:'  Please review this post.  '})).status,201);
  assert.equal((await request(reader,path+'/flag','POST',{reason:'Duplicate'})).status,400);
  assert.equal((await request(owner,path+'/flag','POST',{reason:'Second report'})).status,201);
  assert.equal((await request(owner,commentPath+'/flag','POST',{reason:'Please review this comment.'})).status,201);
  const reply=(await db.query("INSERT INTO comments(post_id,parent_comment_id,author_id,body) VALUES($1,$2,$3,'Nested reply') RETURNING *",[post.post_id,comment.comment_id,reader.user_id])).rows[0];
  assert.equal((await request(author,path+'/comments/'+reply.comment_id+'/flag','POST',{reason:'Nested report'})).status,201);
  for (const member of [reader,author]) assert.equal((await request(member,'/moderation/flags')).status,403);
  await db.query("UPDATE forum_content_flags SET created_at = '2026-10-28 15:45:42'::timestamp WHERE post_id=$1 AND flagged_by=$2", [post.post_id, reader.user_id]);
  for (const staff of [owner,admin,moderator]) {
    const queue=await request(staff,'/moderation/flags');assert.equal(queue.status,200);
    assert.equal(queue.data.posts[0].reports.length,2);
    assert.equal(queue.data.posts[0].reports[0].reason,'Please review this post.');
    assert.equal(queue.data.posts[0].reports[0].reporter_username,reader.username);
    assert.equal(new Date(queue.data.posts[0].reports[0].created_at).toISOString(), '2026-10-28T15:45:42.000Z');
    assert.equal(new Intl.DateTimeFormat('en-US', { timeZone:'America/Chicago', hour:'numeric', minute:'2-digit' }).format(new Date(queue.data.posts[0].reports[0].created_at)), '10:45 AM');
    for (const report of queue.data.comments.flatMap(item => item.reports)) assert.match(report.created_at, /(?:Z|\+00:00)$/);
    assert.ok(queue.data.posts[0].created_at);
    assert.ok(Object.hasOwn(queue.data.posts[0].reports[0], 'reporter_avatar_url'));
    assert.ok(queue.data.comments.every(item => Object.hasOwn(item, 'parent_comment_id') && item.created_at));
    assert.equal(queue.data.comments.length,2);
  }
  const detail=await request(reader,path);assert.equal(detail.status,200);
  assert.ok(!JSON.stringify(detail.data).includes('Please review this post.'));
  assert.equal((await db.query('SELECT active,deleted_at FROM posts WHERE post_id=$1',[post.post_id])).rows[0].active,true);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM notifications WHERE type IN (\'flagged_post\',\'flagged_comment\')')).rows[0].n,10);
  assert.equal((await request(moderator,'/moderation/flags/posts/'+post.post_id+'/review','PATCH')).status,200);
  assert.equal((await request(owner,'/moderation/flags')).data.posts.length,0);
  console.log('PASS reports: reason validation, self/duplicate restrictions, nested replies, all reporting roles, staff-only reporter details, notifications, visible content, review.');

} finally {
  if (server) await new Promise(resolve=>server.close(resolve));
  await db.query('ROLLBACK');
  await db.end();
}
