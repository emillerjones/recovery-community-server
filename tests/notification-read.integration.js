import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import express from 'express';
process.env.DB_CLIENT_MODE='single';
const {default:db}=await import('../db/client.js');
const {default:notifications}=await import('../api/notifications.js');
const {default:forum}=await import('../api/forum.js');
const {default:staffChat}=await import('../api/staffChat.js');
const {default:getUserFromToken}=await import('../middleware/getUserFromToken.js');
const {createToken}=await import('../utils/jwt.js');
const schema=`test_notification_read_${randomUUID().replaceAll('-','')}`;
let server;
await db.connect();
try{
  await db.query('BEGIN');await db.query(`CREATE SCHEMA ${schema}`);await db.query(`SET LOCAL search_path TO ${schema}`);
  await db.query(await fs.readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
  // Reproduce production's old trigger before applying the actual repair migration.
  await db.query((await fs.readFile(new URL('../db/migrations/024_add_staff_announcements.sql',import.meta.url),'utf8')).replace(/^BEGIN;|^COMMIT;/gm,''));
  await db.query("INSERT INTO user_roles(role_id,role_name) VALUES(1,'Owner'),(50,'Moderator'),(100,'Member')");
  await db.query("INSERT INTO users(role_id,email,password,username,is_system) VALUES(50,'system@test.invalid','unused','system',TRUE)");
  await db.query("INSERT INTO forum_categories(name,slug) VALUES('Introductions','introductions')");
  const users=(await db.query(`INSERT INTO users(role_id,email,password,username) VALUES
    (1,'owner@test.invalid','unused','owner'),(50,'mod@test.invalid','unused','moderator'),
    (100,'author@test.invalid','unused','author'),(100,'member@test.invalid','unused','member') RETURNING *`)).rows;
  const [owner,mod,author,member]=users;
  const category=(await db.query("INSERT INTO forum_categories(name,slug) VALUES('Public','public-test') RETURNING *")).rows[0];
  const staffCategory=(await db.query("SELECT category_id FROM forum_categories WHERE slug='staff-announcements'")).rows[0];
  async function makePost(title,categoryId=category.category_id){return (await db.query('INSERT INTO posts(category_id,author_id,title,body) VALUES($1,$2,$3,\'Example text\') RETURNING *',[categoryId,author.user_id,title])).rows[0];}
  const moved=await makePost('Existing conversation moved to staff');
  const publicPost=await makePost('Still public');
  const reply=(await db.query("INSERT INTO comments(post_id,author_id,body) VALUES($1,$2,'Existing reply') RETURNING *",[moved.post_id,author.user_id])).rows[0];
  // Explicit fixtures avoid depending on whatever automatic notices other triggers create.
  await db.query('DELETE FROM notifications');
  async function alert(user,postId=moved.post_id,commentId=null){return (await db.query(`INSERT INTO notifications(user_id,actor_id,type,post_id,comment_id)
    VALUES($1,$2,$3,$4,$5) RETURNING *`,[user.user_id,author.user_id,commentId?'reply_to_comment':'new_forum_post',postId,commentId])).rows[0];}
  const individual=await alert(owner);
  const batch=await alert(owner,moved.post_id,reply.comment_id);
  const modNotice=await alert(mod);
  const memberNotice=await alert(member);
  const publicNotice=await alert(owner,publicPost.post_id);
  await db.query('UPDATE posts SET category_id=$2 WHERE post_id=$1',[moved.post_id,staffCategory.category_id]);
  assert.equal((await db.query('UPDATE notifications SET read_at=NOW() WHERE notification_id=$1 RETURNING notification_id',[individual.notification_id])).rowCount,0,'Old trigger reproduces silent read-update rejection');
  const fix=(await fs.readFile(new URL('../db/migrations/036_allow_staff_notification_read_updates.sql',import.meta.url),'utf8')).replace(/^BEGIN;|^COMMIT;/gm,'');
  await db.query(fix);await db.query(fix);

  const app=express();app.use(express.json());app.use(getUserFromToken);
  app.use('/api/notifications',notifications);app.use('/api/forum',forum);app.use('/api/staff-chat',staffChat);
  const tokens=new Map(users.map(user=>[user.user_id,createToken({id:user.user_id,role_id:user.role_id,auth_version:user.auth_version})]));
  server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  async function request(user,path,method='GET',body){const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{...(user?{Authorization:`Bearer ${tokens.get(user.user_id)}`} :{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const text=await response.text();return {status:response.status,data:(()=>{try{return JSON.parse(text);}catch{return text;}})()};}
  assert.equal((await request(null,'/notifications/read-all','PATCH')).status,401);
  assert.equal((await request(member,`/notifications/${individual.notification_id}/read`,'PATCH')).status,404,'Cannot mark another user notification');
  const result=await request(owner,`/notifications/${individual.notification_id}/read`,'PATCH');assert.equal(result.status,200);assert.ok(result.data.read_at);
  assert.equal((await request(owner,`/notifications/${individual.notification_id}/read`,'PATCH')).status,200,'Individual read is idempotent');
  assert.equal((await request(owner,'/notifications/unread-count')).data.count,2);
  assert.ok((await request(owner,'/notifications')).data.find(row=>row.notification_id===individual.notification_id).read_at,'Fresh GET preserves read state');
  assert.equal((await request(member,`/forum/posts/${moved.post_id}`)).status,404,'Read acknowledgment does not grant staff-post access');
  assert.equal((await request(member,`/notifications/${memberNotice.notification_id}/read`,'PATCH')).status,200,'Legacy member alert can be dismissed without granting content access');

  // Staff state uses forum_post_reads and lounge_reads, not notifications.read_at.
  const room=(await db.query("SELECT room_id FROM lounge_rooms WHERE slug='staff-chat'")).rows[0];
  await db.query("INSERT INTO lounge_messages(room_id,author_id,author_username,body) VALUES($1,$2,'author','Private staff message')",[room.room_id,author.user_id]);
  const staffUnread=(await request(owner,'/forum/staff/unread-count')).data.count;
  const chatUnread=(await request(owner,'/staff-chat/unread-count')).data.count;
  assert.ok(staffUnread>0);assert.equal(chatUnread,1);
  assert.equal((await request(owner,'/notifications/read-all','PATCH')).status,200);
  assert.equal((await request(owner,'/notifications/unread-count')).data.count,0);
  assert.equal((await request(owner,'/forum/staff/unread-count')).data.count,staffUnread,'Regular bell does not clear staff announcements');
  assert.equal((await request(owner,'/staff-chat/unread-count')).data.count,chatUnread,'Regular bell does not clear Staff Chat');
  assert.equal((await request(mod,'/notifications/unread-count')).data.count,1,'Other recipient untouched');
  assert.ok((await db.query('SELECT read_at FROM notifications WHERE notification_id=$1',[batch.notification_id])).rows[0].read_at);
  assert.ok((await db.query('SELECT read_at FROM notifications WHERE notification_id=$1',[publicNotice.notification_id])).rows[0].read_at);
  const freshPublic=await alert(owner,publicPost.post_id);
  assert.equal((await request(owner,'/forum/posts/read-all','PATCH',{section:'staff'})).status,200);
  assert.equal((await request(owner,'/staff-chat/read','PATCH')).status,200);
  assert.equal((await request(owner,'/forum/staff/unread-count')).data.count,0);
  assert.equal((await request(owner,'/staff-chat/unread-count')).data.count,0);
  assert.equal((await request(owner,'/notifications/unread-count')).data.count,1,'Staff shield does not clear regular notifications');
  assert.equal((await db.query('SELECT read_at FROM notifications WHERE notification_id=$1',[freshPublic.notification_id])).rows[0].read_at,null);
  assert.equal((await request(owner,'/notifications/read-all','PATCH')).status,200);
  assert.equal((await request(owner,'/notifications/unread-count')).data.count,0);

  // Retain all staff-notification suppression except non-null read-only updates.
  assert.equal(await alert(owner),undefined,'New staff-post alerts remain suppressed');
  assert.equal(await alert(owner,null,reply.comment_id),undefined,'Comment-only staff targets remain suppressed');
  assert.equal((await db.query('UPDATE notifications SET read_at=NULL WHERE notification_id=$1 RETURNING *',[individual.notification_id])).rowCount,0,'Cannot resurrect staff alert as unread');
  assert.equal((await db.query("UPDATE notifications SET read_at=NOW(),type='mention_in_post' WHERE notification_id=$1 RETURNING *",[individual.notification_id])).rowCount,0,'Read exemption cannot mask other changes');
  const publicAgain=await alert(owner,publicPost.post_id);
  assert.equal((await db.query('UPDATE notifications SET post_id=$2 WHERE notification_id=$1 RETURNING *',[publicAgain.notification_id,moved.post_id])).rowCount,0,'Cannot retarget a public alert to staff');
  assert.equal((await request(owner,`/notifications/${publicAgain.notification_id}/read`,'PATCH')).status,200,'Public notifications still read normally');
  assert.equal((await request(mod,'/notifications/read-all','PATCH')).status,200);
  assert.equal((await request(mod,'/notifications/unread-count')).data.count,0);
  console.log('PASS notification reads: reproduced old bug; migration idempotence; individual/all reads persist; public and moved alerts; own-recipient restriction; regular/staff read states independent; staff inserts, retargeting and unread resets still suppressed.');
}finally{if(server)await new Promise(resolve=>server.close(resolve));await db.query('ROLLBACK');await db.end();}
