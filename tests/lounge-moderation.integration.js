import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import express from 'express';
process.env.DB_CLIENT_MODE='single';
const {default:db}=await import('../db/client.js');
const queries=await import('../db/queries/loungeModeration.js');
const {moderationConfig,DEFAULT_THRESHOLDS,evaluateResponse}=await import('../utils/loungeModerationConfig.js');
const {processModerationJob}=await import('../utils/loungeModerationProcessor.js');
const {default:router}=await import('../api/loungeModeration.js');
const {default:lounge}=await import('../api/lounge.js');
const {effectiveModerationConfig}=await import('../utils/loungeModerationState.js');
const schema=`test_lounge_ai_${randomUUID().replaceAll('-','')}`;
let server;
await db.connect();
try {
  await db.query('BEGIN');await db.query(`CREATE SCHEMA ${schema}`);await db.query(`SET LOCAL search_path TO ${schema}`);
  await db.query(`CREATE TABLE users(user_id SERIAL PRIMARY KEY,username TEXT,role_id INT,avatar_url TEXT,account_status TEXT DEFAULT 'approved',active BOOLEAN DEFAULT TRUE,deleted_at TIMESTAMPTZ)`);
  for(const file of ['014_add_community_lounge.sql','023_add_staff_chat.sql'])await db.query((await fs.readFile(new URL(`../db/migrations/${file}`,import.meta.url),'utf8')).replace(/^BEGIN;|^COMMIT;/gm,''));
  const users=(await db.query(`INSERT INTO users(username,role_id)VALUES('member',100),('moderator',50),('admin',10),('owner',1) RETURNING *`)).rows;
  const [member,mod,admin,owner]=users;
  async function message(body='New recovery message',room='community-lounge') {
    return (await db.query(`INSERT INTO lounge_messages(room_id,author_id,author_username,body)SELECT room_id,$2,'member',$3 FROM lounge_rooms WHERE slug=$1 RETURNING *`,[room,member.user_id,body])).rows[0];
  }
  const historical=await message('Historical message');
  await db.query((await fs.readFile(new URL('../db/migrations/033_add_lounge_moderation.sql',import.meta.url),'utf8')).replace(/^BEGIN;|^COMMIT;/gm,''));
  await db.query((await fs.readFile(new URL('../db/migrations/033_add_lounge_moderation.sql',import.meta.url),'utf8')).replace(/^BEGIN;|^COMMIT;/gm,''));
  for(let i=0;i<2;i++)await db.query((await fs.readFile(new URL('../db/migrations/034_add_lounge_moderation_settings.sql',import.meta.url),'utf8')).replace(/^BEGIN;|^COMMIT;/gm,''));
  assert.equal((await db.query('SELECT COUNT(*)::INT n FROM moderation_jobs')).rows[0].n,0);
  assert.equal(moderationConfig({}).enabled,false);
  assert.equal(moderationConfig({LOUNGE_MODERATION_MODE:'testing',OPENAI_API_KEY:'test'}).enabled,true);
  assert.ok(moderationConfig({LOUNGE_MODERATION_THRESHOLDS:'{"harassment":2}'}).error);
  assert.ok(moderationConfig({LOUNGE_MODERATION_THRESHOLDS:'{"typo":0.5}'}).error);
  assert.ok(moderationConfig({LOUNGE_MODERATION_THRESHOLDS:'null'}).error);
  const response=(flagged=true,score=.99)=>({id:'mock-id',model:'omni-moderation-latest',results:[{flagged,categories:{},category_scores:{...Object.fromEntries(Object.keys(DEFAULT_THRESHOLDS).map(key=>[key,.001])),harassment:score}}]});
  assert.deepEqual(evaluateResponse(response(false),DEFAULT_THRESHOLDS),['harassment'],'Uses thresholds even when API flagged is false');
  assert.deepEqual(evaluateResponse(response(true,.01),DEFAULT_THRESHOLDS),[],'Does not rely on API flagged');
  const config={...moderationConfig({LOUNGE_MODERATION_MODE:'testing',OPENAI_API_KEY:'mock'}),enabled:true};
  const a=await message();await message('Private staff text','staff-chat');
  assert.equal((await db.query('SELECT COUNT(*)::INT n FROM moderation_jobs')).rows[0].n,1);
  let calls=0;
  const mockFetch=async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/moderations');assert.deepEqual(JSON.parse(options.body),{model:'omni-moderation-latest',input:a.body});return {ok:true,json:async()=>response(false)};};
  assert.equal(await processModerationJob({config:{enabled:false},fetchImpl:mockFetch}),false);assert.equal(calls,0);
  await processModerationJob({config,fetchImpl:mockFetch});assert.equal(calls,1);
  await processModerationJob({config,fetchImpl:mockFetch});assert.equal(calls,1,'Completed jobs not repeated');
  let result=(await db.query('SELECT * FROM moderation_results')).rows[0];assert.equal(result.review_status,'pending');assert.deepEqual(result.response,response(false));
  assert.equal((await queries.getReviewQueue({})).pending,1);
  assert.equal((await db.query('SELECT deleted_at FROM lounge_messages WHERE message_id=$1',[a.message_id])).rows[0].deleted_at,null);

  const app=express();app.use(express.json());app.use((req,res,next)=>{req.user=users.find(user=>String(user.user_id)===req.headers['x-user']);next();});
  app.use('/review',router);app.use('/lounge',lounge);
  server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  async function request(user,path='',method='GET',body){
    const response=await fetch(`http://127.0.0.1:${server.address().port}${path.startsWith('/lounge')?'':'/review'}${path}`,{method,headers:{...(user?{'x-user':String(user.user_id)}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const text=await response.text();return {status:response.status,data:(()=>{try{return JSON.parse(text);}catch{return text;}})()};
  }
  for(const path of ['', '/failures',`/messages/${a.message_id}/context`]){
    assert.equal((await request(null,path)).status,401);assert.equal((await request(member,path)).status,403);
  }
  for(const staff of [mod,admin,owner])assert.equal((await request(staff)).status,200);
  // Global controls are Owner-only, validated, audited, and revision protected.
  assert.equal((await request(null,'/settings')).status,401);
  for(const denied of [member,mod,admin]){
    assert.equal((await request(denied,'/settings')).status,403);
    assert.equal((await request(denied,'/settings','PATCH',{enabled:true,revision:1})).status,403);
  }
  for(const body of [{},{enabled:'true',revision:1},{enabled:true},{enabled:true,revision:-1},{enabled:true,revision:1.2}])assert.equal((await request(owner,'/settings','PATCH',body)).status,400);
  assert.equal((await request(owner,'/settings')).data.processing.ownerEnabled,false);
  assert.equal((await request(owner,'/settings','PATCH',{enabled:true,revision:1})).status,200);
  assert.equal((await request(owner,'/settings','PATCH',{enabled:false,revision:1})).status,409,'Stale Owner form cannot overwrite current setting');
  let settings=(await request(owner,'/settings')).data;
  assert.equal(settings.processing.ownerEnabled,true);assert.equal(settings.processing.settingsRevision,2);
  assert.equal(settings.history.length,1);assert.equal(settings.history[0].changed_by_username,'owner');
  assert.equal((await request(owner,'/settings','PATCH',{enabled:true,revision:2})).status,200,'No-op is idempotent');
  assert.equal((await request(owner,'/settings')).data.history.length,1);
  const priorMode=process.env.LOUNGE_MODERATION_MODE,priorKey=process.env.OPENAI_API_KEY;
  try{
    process.env.LOUNGE_MODERATION_MODE='off';process.env.OPENAI_API_KEY='mock';
    assert.equal((await effectiveModerationConfig()).enabled,false,'Render off overrides Owner enabled');
    process.env.LOUNGE_MODERATION_MODE='testing';
    assert.equal((await effectiveModerationConfig()).enabled,true);
    delete process.env.OPENAI_API_KEY;assert.equal((await effectiveModerationConfig()).enabled,false,'Missing key prevents processing');
    process.env.OPENAI_API_KEY='mock';
    await request(owner,'/settings','PATCH',{enabled:false,revision:2});
    const beforeCalls=calls;
    assert.equal(await processModerationJob({fetchImpl:mockFetch}),false,'Default processor respects Owner pause');assert.equal(calls,beforeCalls);
    assert.equal((await effectiveModerationConfig()).enabled,false);
    settings=(await request(owner,'/settings')).data;
    assert.equal(settings.history.length,2);assert.equal(settings.history[0].enabled,false);assert.equal(settings.processing.settingsRevision,3);
    // Check the actual default worker path picks up saved changes without restart.
    const settingsJob=await message('Owner-enabled worker check');
    await request(owner,'/settings','PATCH',{enabled:true,revision:3});
    let workerCalls=0;
    assert.equal(await processModerationJob({fetchImpl:async()=>{workerCalls++;return {ok:true,json:async()=>response(true,.01)};}}),true);
    assert.equal(workerCalls,1);
    assert.equal((await db.query('SELECT status FROM moderation_jobs WHERE message_id=$1',[settingsJob.message_id])).rows[0].status,'completed');
    await request(owner,'/settings','PATCH',{enabled:false,revision:4});
    assert.equal(await processModerationJob({fetchImpl:mockFetch}),false);
  }finally{
    if(priorMode===undefined)delete process.env.LOUNGE_MODERATION_MODE;else process.env.LOUNGE_MODERATION_MODE=priorMode;
    if(priorKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=priorKey;
  }
  assert.equal((await request(mod,'?page=-1')).status,400);
  assert.equal((await request(mod,`/results/${result.result_id}/review`,'POST',{action:'delete'})).status,403);
  assert.equal((await request(mod,`/results/${result.result_id}/review`,'POST',{action:'clear'})).status,200);
  assert.equal((await request(owner,`/results/${result.result_id}/review`,'POST',{action:'clear'})).status,409);
  assert.equal((await queries.getReviewQueue({})).pending,0);
  assert.equal((await queries.getReviewQueue({status:'reviewed'})).items.length,1);
  assert.equal((await db.query('SELECT COUNT(*)::INT n FROM moderation_review_actions')).rows[0].n,1);

  await db.query('UPDATE lounge_messages SET body=$2 WHERE message_id=$1',[a.message_id,'Edited body']);
  await processModerationJob({config,fetchImpl:async()=>({ok:true,json:async()=>response()})});
  result=(await queries.getReviewQueue({})).items[0];assert.equal(result.content_version,2);
  assert.equal((await request(mod,`/lounge/messages/${a.message_id}`,'DELETE')).status,403,'Mod cannot bypass review deletion restriction through normal Lounge route');
  assert.equal((await request(owner,`/results/${result.result_id}/review`,'POST',{action:'delete'})).status,200);
  assert.equal((await queries.getReviewQueue({})).pending,0);
  assert.ok((await queries.getReviewQueue({status:'reviewed'})).items[0].deleted_at);
  assert.ok((await db.query('SELECT body,deleted_at FROM lounge_messages WHERE message_id=$1',[a.message_id])).rows[0].body,'Soft deletion retains record');
  const privateMessage=await message('Staff context secret','staff-chat');
  assert.equal((await request(owner,`/messages/${privateMessage.message_id}/context`)).status,404);
  const context=(await request(owner,`/messages/${a.message_id}/context`)).data;
  assert.ok(context.messages.every(message=>!message.body?.includes('Staff context')));
  assert.equal(context.messages.find(message=>message.message_id===a.message_id).body,null);

  // A late result cannot flag an edited message.
  const b=await message('Before edit');const old=await queries.claimJob();
  await db.query('UPDATE lounge_messages SET body=$2 WHERE message_id=$1',[b.message_id,'After edit']);
  assert.equal(await queries.completeJob(old,response(),DEFAULT_THRESHOLDS,['harassment']),false);
  const current=await queries.claimJob();await queries.completeJob(current,response(true,.01),DEFAULT_THRESHOLDS,[]);
  assert.equal((await db.query('SELECT review_status FROM moderation_results WHERE message_id=$1',[b.message_id])).rows[0].review_status,'not_needed');

  // Stale claim recovery, uniqueness, retry backoff and controlled error storage.
  const c=await message('Lease recovery');const claim1=await queries.claimJob();assert.equal(await queries.claimJob(),undefined);
  await db.query("UPDATE moderation_jobs SET claimed_until=NOW()-INTERVAL '1 second' WHERE job_id=$1",[claim1.job_id]);
  const claim2=await queries.claimJob();assert.notEqual(claim2.claim_token,claim1.claim_token);
  assert.equal(await queries.completeJob(claim1,response(),DEFAULT_THRESHOLDS,['harassment']),false);
  await queries.failJob(claim2,'API HTTP 429');assert.equal(await queries.claimJob(),undefined);
  await db.query("UPDATE moderation_jobs SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE message_id=$1",[c.message_id]);
  await processModerationJob({config,fetchImpl:async()=>{throw new Error('Secret must not be stored');}});
  assert.equal((await db.query('SELECT last_error FROM moderation_jobs WHERE message_id=$1',[c.message_id])).rows[0].last_error,'API network error or timeout');
  await db.query("UPDATE moderation_jobs SET attempt_count=4,next_attempt_at=NOW()-INTERVAL '1 second' WHERE message_id=$1",[c.message_id]);
  await processModerationJob({config,fetchImpl:async()=>({ok:false,status:429})});
  assert.equal((await queries.failedJobs()).length,1);
  const failed=(await queries.failedJobs())[0];assert.equal((await request(member,`/jobs/${failed.job_id}/retry`,'POST')).status,403);
  assert.equal((await request(mod,`/jobs/${failed.job_id}/retry`,'POST')).status,200);
  await processModerationJob({config,fetchImpl:async()=>({ok:true,json:async()=>({results:[]})})});
  assert.equal((await db.query('SELECT last_error FROM moderation_jobs WHERE job_id=$1',[failed.job_id])).rows[0].last_error,'Invalid moderation response');
  await db.query("UPDATE moderation_jobs SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE message_id=$1",[c.message_id]);
  await processModerationJob({config,fetchImpl:async()=>({ok:true,json:async()=>response()})});
  result=(await queries.getReviewQueue({})).items[0];
  await db.query("UPDATE moderation_results SET checked_at=NOW()-INTERVAL '91 days' WHERE result_id=$1",[result.result_id]);
  await queries.purgeModerationData();const purged=(await db.query('SELECT * FROM moderation_results WHERE result_id=$1',[result.result_id])).rows[0];
  assert.equal(purged.response,null);assert.equal(purged.content_snapshot,null);assert.equal(purged.review_status,'expired');

  // Simulate enqueue failure: message succeeds and reconciliation repairs only new versions.
  await db.query('ALTER TABLE moderation_jobs RENAME TO unavailable_jobs');
  const missed=await message('Published even if queue insertion fails');
  await db.query('ALTER TABLE unavailable_jobs RENAME TO moderation_jobs');
  await queries.reconcileJobs();await queries.reconcileJobs();
  assert.equal((await db.query('SELECT COUNT(*)::INT n FROM moderation_jobs WHERE message_id=$1',[missed.message_id])).rows[0].n,1);
  assert.equal((await db.query('SELECT COUNT(*)::INT n FROM moderation_jobs WHERE message_id=$1',[historical.message_id])).rows[0].n,0);
  assert.equal((await request(member,`/lounge/messages/${missed.message_id}`,'DELETE')).status,200,'Members can still delete their own messages');
  const suspended={...mod,active:false};users[1]=suspended;assert.equal((await request(suspended)).status,403);
  console.log('PASS Lounge AI: migration/no backfill, staff exclusion, fail-open enqueue/repair, disabled mode, full result storage, threshold validation, publication, role boundaries, context privacy, clear/delete audit, edits, stale claims, retries, retention.');
} finally {if(server)await new Promise(resolve=>server.close(resolve));await db.query('ROLLBACK');await db.end();}
