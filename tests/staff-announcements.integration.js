import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import express from "express";

const clientRequire = createRequire(new URL("../../recovery-community-client/package.json", import.meta.url));
const { io: connectSocket } = clientRequire("socket.io-client");
process.env.DB_CLIENT_MODE = "single";
const { default: db } = await import("../db/client.js");
const { default: forum } = await import("../api/forum.js");
const { default: getUserFromToken } = await import("../middleware/getUserFromToken.js");
const { getViewableMedia } = await import("../db/queries/media.js");
const { getCommunityPulse } = await import("../db/queries/lounge.js");
const { createToken } = await import("../utils/jwt.js");
const { initSocket, notifyThread } = await import("../utils/socket.js");
let server, io;
const sockets = [];
const schema = `test_staff_announcements_${randomUUID().replaceAll("-", "")}`;
await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`SET LOCAL search_path TO ${schema}`);
  const baseSchema = (await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8")).split("-- Staff-only forum category and alert suppression.")[0];
  await db.query(baseSchema);
  const migration = (await fs.readFile(new URL("../db/migrations/024_add_staff_announcements.sql", import.meta.url), "utf8")).replace(/^BEGIN;|^COMMIT;/gm, "");
  await db.query(migration);
  await db.query(migration);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM forum_categories WHERE slug='staff-announcements'")).rows[0].n, 1);
  await db.query("INSERT INTO user_roles(role_id,role_name) VALUES(1,'Owner'),(10,'Admin'),(50,'Moderator'),(100,'Member')");
  await db.query("INSERT INTO users(role_id,email,password,username,is_system) VALUES(50,'system@test.invalid','unused','system',TRUE)");
  await db.query("INSERT INTO forum_categories(name,slug) VALUES('Introductions','introductions'),('Main','general-recovery'),('Announcements','announcements')");
  const { rows: users } = await db.query(`INSERT INTO users(role_id,email,password,username) VALUES
    (100,'member@test.invalid','unused','member'),(50,'mod@test.invalid','unused','moderator'),
    (10,'admin@test.invalid','unused','admin'),(1,'owner@test.invalid','unused','owner'),
    (50,'other-mod@test.invalid','unused','othermod') RETURNING *`);
  const [member, moderator, admin, owner, othermod] = users;
  const categories = (await db.query("SELECT * FROM forum_categories")).rows;
  const staffCategory = categories.find(c=>c.slug==='staff-announcements');
  const publicCategory = categories.find(c=>c.slug==='general-recovery');
  const tokens = new Map(users.map(user=>[user.user_id,createToken({id:user.user_id,role_id:user.role_id,auth_version:0})]));
  const app=express();
  app.use(express.json()); app.use(getUserFromToken); app.use('/api/forum',forum);
  app.use((error,req,res,next)=>{ console.error(error); res.status(500).json({message:error.message}); });
  server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  io=initSocket(server);
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(user,path,method='GET',body) {
    const response=await fetch(base+'/api/forum'+path,{method,headers:{...(user?{Authorization:`Bearer ${tokens.get(user.user_id)}`} :{}),'Content-Type':'application/json'},...(body&&method!=='GET'?{body:JSON.stringify(body)}:{})});
    const text=await response.text();
    return {status:response.status,data:(()=>{try{return JSON.parse(text);}catch{return text;}})()};
  }
  async function socketFor(user) {
    const socket=connectSocket(base,{auth:{token:tokens.get(user.user_id)},transports:['websocket'],reconnection:false}); sockets.push(socket);
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);}); return socket;
  }
  const newPost = (actor, extra={})=>request(actor,'/posts','POST',{category_id:staffCategory.category_id,audience:'staff',title:'Private guideline',body:'Private guidance @member',mentioned_user_ids:[member.user_id],...extra});
  assert.equal((await newPost(null)).status,401);
  assert.equal((await newPost(member)).status,403);
  assert.equal((await newPost(owner,{audience:'members'})).status,400);
  assert.equal((await newPost(owner,{category_id:publicCategory.category_id})).status,400);
  assert.ok(!(await request(member,'/categories')).data.some(c=>c.slug==='staff-announcements'));
  assert.ok((await request(owner,'/categories')).data.some(c=>c.slug==='staff-announcements'));
  const publicPost=(await newPost(member,{category_id:publicCategory.category_id,audience:'members',title:'Public post',body:'Public conversation'})).data;
  const pulseBefore=await getCommunityPulse();
  const created=await newPost(moderator); assert.equal(created.status,201,JSON.stringify(created.data));
  const privatePost=created.data, path=`/posts/${privatePost.post_id}`;
  for (const actor of [admin,owner,othermod]) assert.equal((await newPost(actor)).status,201);
  assert.equal((await request(member,'/posts?section=staff')).status,403);
  assert.equal((await request(member,'/posts?category=staff-announcements')).status,403);
  for (const suffix of ['', '?search=Private', '?scope=mine', '?scope=following', '?scope=unread', '?section=announcements']) {
    const result=await request(member,'/posts'+suffix); assert.equal(result.status,200);
    assert.ok(result.data.posts.every(p=>p.category_slug!=='staff-announcements'));
  }
  assert.equal((await request(owner,'/posts?section=staff')).data.posts.length,4);
  assert.ok((await request(owner,'/posts')).data.posts.every(p=>p.category_slug!=='staff-announcements'));
  const reply=await request(othermod,path+'/comments','POST',{body:'Staff reply @member',mentioned_user_ids:[member.user_id]}); assert.equal(reply.status,201);
  const replyId=reply.data.comment_id;
  const protectedRequests=[
    [path,'GET'],[path+'/history','GET'],[path,'PATCH',{body:'Intrusion'}], [path,'DELETE'],
    [path+'/comments','POST',{body:'Intrusion'}],[path+'/comments/'+replyId,'PATCH',{body:'Intrusion'}],
    [path+'/comments/'+replyId,'DELETE'],[path+'/reaction','PUT',{reaction_type:'agree'}],
    [path+'/reaction','DELETE'],[path+'/read','PATCH'],[path+'/follow','POST'],
    [path+'/moderation','PATCH',{pinned:true}], [path+'/poll','GET'], [path+'/poll/vote','PUT',{option_ids:[1]}],
  ];
  for(const [target,method,body] of protectedRequests) assert.equal((await request(member,target,method,body)).status,404,`${method} ${target}`);
  assert.equal((await request(member,`/posts/${publicPost.post_id}/comments/${replyId}/reaction`,'PUT',{reaction_type:'agree'})).status,404);
  for(const actor of [admin,othermod]) assert.equal((await request(actor,path,'PATCH',{body:'Someone else editing'})).status,404);
  assert.equal((await request(moderator,path,'PATCH',{body:'Author revision'})).status,200);
  assert.equal((await request(owner,path,'PATCH',{body:'Owner revision'})).status,200);
  assert.equal((await request(admin,path+'/history')).data.length,2);
  assert.equal((await request(moderator,path+'/moderation','PATCH',{pinned:true})).status,403);
  assert.equal((await request(admin,path+'/moderation','PATCH',{pinned:true})).status,200);
  assert.equal((await request(othermod,path+'/reaction','PUT',{reaction_type:'agree'})).status,200);
  assert.deepEqual((await request(owner,path)).data.post.acknowledgments.map(u=>u.username),['othermod']);
  const pulseAfter=await getCommunityPulse(); assert.deepEqual(pulseAfter,pulseBefore,'Private posts/replies/reactions must not affect Community Pulse');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM notifications WHERE post_id=$1',[privatePost.post_id])).rows[0].n,0);
  // Even a notification creator outside this router is stopped by the DB trigger.
  await db.query("INSERT INTO notifications(user_id,actor_id,type,post_id) VALUES($1,$2,'mention_in_post',$3)",[member.user_id,owner.user_id,privatePost.post_id]);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM notifications WHERE post_id=$1',[privatePost.post_id])).rows[0].n,0);
  // Staff post/reply photos are protected even when their media IDs are known.
  const {rows:media}=await db.query(`INSERT INTO media_assets(uploaded_by,provider_asset_id,format,byte_size,width,height,status)
    VALUES($1,'staff-post-test','webp',100,10,10,'attached'),($1,'staff-reply-test','webp',100,10,10,'attached') RETURNING *`,[moderator.user_id]);
  await db.query('INSERT INTO forum_post_images(post_id,media_id,display_order) VALUES($1,$2,0)',[privatePost.post_id,media[0].media_id]);
  await db.query('INSERT INTO forum_comment_images(comment_id,media_id,display_order) VALUES($1,$2,0)',[replyId,media[1].media_id]);
  for(const asset of media){assert.equal(await getViewableMedia(asset.media_id,member.user_id),undefined);assert.ok(await getViewableMedia(asset.media_id,owner.user_id));}
  const memberSocket=await socketFor(member), modSocket=await socketFor(moderator), ownerSocket=await socketFor(owner);
  const memberEvents=[],modEvents=[],ownerEvents=[];
  memberSocket.on('new_comment',v=>memberEvents.push(v));modSocket.on('new_comment',v=>modEvents.push(v));ownerSocket.on('new_comment',v=>ownerEvents.push(v));
  const join=(socket,id=privatePost.post_id)=>socket.timeout(3000).emitWithAck('join_thread',id);
  assert.equal((await join(memberSocket)).ok,false);assert.equal((await join(modSocket)).ok,true);assert.equal((await join(ownerSocket)).ok,true);
  await notifyThread(privatePost.post_id,'new_comment',{post_id:privatePost.post_id,body:'Private live reply'});
  await join(ownerSocket);await join(modSocket);await join(memberSocket);
  assert.equal(memberEvents.length,0);assert.equal(modEvents.length,1);assert.equal(ownerEvents.length,1);
  await db.query('UPDATE users SET role_id=100 WHERE user_id=$1',[moderator.user_id]);
  assert.equal((await request(moderator,path)).status,404);
  assert.equal((await request(moderator,path,'PATCH',{body:'Former author'})).status,404);
  assert.equal(await getViewableMedia(media[0].media_id,moderator.user_id),undefined);
  await notifyThread(privatePost.post_id,'new_comment',{post_id:privatePost.post_id,body:'After demotion'});
  await join(ownerSocket);assert.equal((await join(modSocket)).ok,false);assert.equal(modEvents.length,1);
  assert.equal((await join(memberSocket,publicPost.post_id)).ok,true);
  await request(member,'/posts/read-all','PATCH');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM forum_post_reads WHERE user_id=$1 AND post_id=$2',[member.user_id,privatePost.post_id])).rows[0].n,0);
  console.log('PASS: migration idempotency, staff visibility, creation audience, author/owner edits, pins, reactions and names, no alerts, public feeds/counts, direct subresources, photos, cross-post reply IDs, private sockets, role demotion and existing member forum.');
} finally {
  for(const socket of sockets)socket.disconnect();
  if(io)await new Promise(resolve=>io.close(resolve));else if(server)await new Promise(resolve=>server.close(resolve));
  await db.query('ROLLBACK');await db.end();
}
