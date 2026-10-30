import express from 'express';
import requireUser from '#middleware/requireUser';
import { failedJobs, getReviewQueue, messageContext, retryFailedJob, reviewResult } from '#db/queries/loungeModeration';
import { effectiveModerationConfig, publicModerationState } from '#utils/loungeModerationState';
import { changeModerationSettings, moderationSettingHistory } from '#db/queries/loungeModerationSettings';
import { notifyLounge } from '#utils/socket';

const router=express.Router();
router.use((req,res,next)=> { res.set('X-Lounge-Moderation','2'); res.set('Cache-Control','no-store'); next(); });
router.use(requireUser);
router.use((req,res,next)=>[1,10,50].includes(req.user.role_id)?next():res.status(403).send({message:'Staff access required.'}));
router.get('/',async(req,res)=>{
  const page=Number(req.query.page||1), search=req.query.search||'', status=req.query.status||'pending';
  if (!Number.isSafeInteger(page)||page<1||page>100000||typeof search!=='string'||search.length>200||!['pending','reviewed'].includes(status)) return res.status(400).send({message:'Invalid queue filters.'});
  const config=await effectiveModerationConfig();
  res.set('Cache-Control','no-store');
  res.send({ ...await getReviewQueue({status,page,search}),processing:publicModerationState(config) });
});
router.get('/settings',ownerOnly,async(req,res)=>res.send({processing:publicModerationState(await effectiveModerationConfig()),history:await moderationSettingHistory()}));
router.patch('/settings',ownerOnly,async(req,res)=>{
  const {enabled,revision}=req.body||{};
  if(typeof enabled!=='boolean'||!Number.isSafeInteger(revision)||revision<1)return res.status(400).send({message:'An enabled checkbox value and current settings revision are required.'});
  const settings=await changeModerationSettings({enabled,revision,userId:req.user.user_id});
  if(!settings)return res.status(409).send({message:'Another Owner changed this setting. Cancel and refresh before trying again.'});
  res.send({processing:publicModerationState(await effectiveModerationConfig())});
});
router.get('/failures',async(req,res)=>res.send({jobs:await failedJobs()}));
router.post('/jobs/:id/retry',async(req,res)=>{
  if (!validId(req.params.id)) return res.status(400).send({message:'Invalid job.'});
  const job=await retryFailedJob(req.params.id);
  if (!job) return res.status(409).send({message:'This job is no longer eligible for retry.'});
  res.send(job);
});
router.get('/messages/:id/context',async(req,res)=>{
  if (!validId(req.params.id)) return res.status(400).send({message:'Invalid message.'});
  const messages=await messageContext(req.params.id);
  if (!messages) return res.status(404).send({message:'Lounge message not found.'});
  res.set('Cache-Control','no-store'); res.send({messages});
});
router.post('/results/:id/review',async(req,res)=>{
  const action=req.body?.action;
  if (!validId(req.params.id)||!['clear','delete'].includes(action)) return res.status(400).send({message:'Invalid review action.'});
  if (action==='delete'&&![1,10].includes(req.user.role_id)) return res.status(403).send({message:'Only Admins and Owners can delete messages.'});
  const result=await reviewResult({resultId:req.params.id,userId:req.user.user_id,action});
  if (!result) return res.status(409).send({message:'This message changed or was already reviewed. Refresh the queue.'});
  if (result.deleted) notifyLounge('lounge_message_deleted',result.deleted);
  res.send(result);
});
function validId(id) { return /^\d+$/.test(id)&&Number.isSafeInteger(Number(id))&&Number(id)>0; }
function ownerOnly(req,res,next) {return req.user.role_id===1?next():res.status(403).send({message:'Only Owners can change or view these moderation settings.'});}
export default router;
