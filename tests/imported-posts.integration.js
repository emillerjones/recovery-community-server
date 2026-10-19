import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import express from "express";

process.env.DB_CLIENT_MODE = "single";
const { default: db } = await import("../db/client.js");
const { default: forum } = await import("../api/forum.js");
const { createForumPost } = await import("../db/queries/forum.js");
const { getNewPostNotifications, getNotifications } = await import("../db/queries/notifications.js");
const { getCommunityPulse } = await import("../db/queries/lounge.js");
const schema = `test_imported_posts_${randomUUID().replaceAll("-", "")}`;
let server;
await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`SET LOCAL search_path TO ${schema}`);
  await db.query(await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
  await db.query("INSERT INTO user_roles(role_id,role_name) VALUES(1,'Owner'),(10,'Admin'),(50,'Moderator'),(100,'Member')");
  await db.query("INSERT INTO users(role_id,email,password,username,is_system) VALUES(50,'system@test.invalid','unused','system',TRUE)");
  await db.query("INSERT INTO forum_categories(name,slug) VALUES('Introductions','introductions'),('General','general-recovery')");
  const { rows: users } = await db.query(`INSERT INTO users(role_id,email,password,username,avatar_url) VALUES
    (1,'owner@test.invalid','unused','owner','preset:Tree:forest'),
    (10,'admin@test.invalid','unused','admin',NULL),(50,'mod@test.invalid','unused','moderator',NULL),
    (100,'member@test.invalid','unused','member',NULL) RETURNING *`);
  const [owner, admin, moderator, member] = users;
  const category = (await db.query("SELECT category_id FROM forum_categories WHERE slug='general-recovery'")).rows[0];

  // Exercise the migration over an existing populated database, not just the
  // fresh schema. Roll back every schema and fixture at the end.
  await db.query('ALTER TABLE posts DROP COLUMN is_imported CASCADE, DROP COLUMN imported_author_label');
  const before = (await db.query('SELECT * FROM posts ORDER BY post_id')).rows;
  const migration = (await fs.readFile(new URL('../db/migrations/027_add_imported_post_authors.sql', import.meta.url), 'utf8'))
    .replace(/^BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
  await db.query(migration); await db.query(migration);
  const after = (await db.query('SELECT * FROM posts ORDER BY post_id')).rows;
  assert.deepEqual(after.map(({is_imported,imported_author_label,...row}) => {
    assert.equal(is_imported,false); assert.equal(imported_author_label,null); return row;
  }), before);

  const app = express(); app.use(express.json());
  app.use((req,res,next) => { req.user=users.find(u=>String(u.user_id)===req.headers['x-test-user']); next(); });
  app.use('/api/forum',forum);
  app.use((error,req,res,next)=>{ console.error(error); res.status(500).json({message:'Test server error'}); });
  server = await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  async function request(user,path,method='GET',body) {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/forum${path}`,{
      method,headers:{'Content-Type':'application/json',...(user?{'x-test-user':String(user.user_id)}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),
    });
    const text=await response.text();
    return {status:response.status,data:(()=>{try{return JSON.parse(text);}catch{return text;}})()};
  }
  const input={category_id:category.category_id,audience:'members',title:'Imported discussion',body:'An archived discussion.',is_imported:true,imported_author_label:'  Participant A  ',author_id:member.user_id};
  assert.equal((await request(null,'/posts','POST',input)).status,401);
  for(const actor of [admin,moderator,member]) {
    assert.equal((await request(actor,'/posts','POST',input)).status,403);
    assert.equal((await request(actor,'/posts','POST',{...input,is_imported:false})).status,403);
    assert.equal(await createForumPost({categoryId:category.category_id,authorId:actor.user_id,title:'Denied',body:'Denied',isImported:true,importedAuthorLabel:'Alias'}),undefined);
  }
  for(const label of [null,12,'','   ','a'.repeat(81),'Bad\nName','Hidden\u202eName']) {
    assert.equal((await request(owner,'/posts','POST',{...input,imported_author_label:label})).status,400);
  }
  assert.equal((await request(owner,'/posts','POST',{...input,is_imported:'true'})).status,400);
  assert.equal((await request(owner,'/posts','POST',{...input,is_imported:false})).status,400);
  const created=await request(owner,'/posts','POST',{...input,mentioned_user_ids:[member.user_id],body:'Archived advice for @member'});
  assert.equal(created.status,201); const post=created.data;
  assert.equal(post.author_id,owner.user_id); assert.equal(post.is_imported,true); assert.equal(post.imported_author_label,'Participant A');
  const path=`/posts/${post.post_id}`;
  for(const actor of users) {
    const thread=(await request(actor,path)).data.post;
    assert.equal(thread.author_username,'Participant A'); assert.equal(thread.author_avatar_url,null);
    assert.equal(thread.author_id,owner.user_id); assert.equal(thread.is_imported,true);
    const feed=(await request(actor,'/posts?search=Imported')).data.posts.find(p=>p.post_id===post.post_id);
    assert.equal(feed.author_username,'Participant A'); assert.equal(feed.author_avatar_url,null); assert.equal(feed.is_imported,true);
  }
  assert.ok((await getNewPostNotifications(post.post_id)).every(n=>n.actor_username==='Participant A (imported post)'));
  const notifications=(await getNotifications(member.user_id)).filter(n=>n.post_id===post.post_id);
  assert.ok(notifications.length>0); assert.ok(notifications.every(n=>n.actor_username==='Participant A (imported post)'));
  const activity=(await getCommunityPulse()).activity.find(a=>a.post_id===post.post_id&&a.activity_type==='post');
  assert.equal(activity.username,'Participant A (imported post)'); assert.equal(activity.avatar_url,null);
  assert.equal((await request(member,path+'/flag','POST')).status,201);
  const flagged=(await request(admin,'/moderation/flags')).data.posts.find(p=>p.post_id===post.post_id);
  assert.equal(flagged.author_username,'Participant A'); assert.equal(flagged.author_avatar_url,null);
  assert.equal((await request(member,path,'PATCH',{body:'Hijacked'})).status,404);
  assert.equal((await request(owner,path,'PATCH',{body:'Owner correction',is_imported:false,imported_author_label:'Changed'})).status,200);
  assert.equal((await request(owner,path)).data.post.imported_author_label,'Participant A');
  const reply=await request(member,path+'/comments','POST',{body:'A regular reply',is_imported:true,imported_author_label:'Fake'});
  assert.equal(reply.status,201); assert.equal(reply.data.author_id,member.user_id); assert.equal(reply.data.author_username,'member');
  assert.equal(reply.data.is_imported,undefined,'Replies retain their existing author model');
  const normal=await request(owner,'/posts','POST',{category_id:category.category_id,title:'Normal post',body:'Written by me.'});
  assert.equal(normal.status,201);
  const normalThread=(await request(member,`/posts/${normal.data.post_id}`)).data.post;
  assert.equal(normalThread.is_imported,false); assert.equal(normalThread.imported_author_label,null);
  assert.equal(normalThread.author_username,'owner'); assert.equal(normalThread.author_avatar_url,owner.avatar_url);
  await db.query('SAVEPOINT invalid_import');
  await assert.rejects(db.query("UPDATE posts SET imported_author_label=NULL WHERE post_id=$1",[post.post_id]),e=>e.code==='23514');
  await db.query('ROLLBACK TO SAVEPOINT invalid_import');
  console.log('PASS: migration/defaults/idempotency, owner-only API and query guard, validation, actual creator, alias/neutral avatar in feed/thread/flags/alerts/pulse, edits, normal posts and unchanged replies.');
} finally {
  if(server)await new Promise(resolve=>server.close(resolve));
  await db.query('ROLLBACK'); await db.end();
}
