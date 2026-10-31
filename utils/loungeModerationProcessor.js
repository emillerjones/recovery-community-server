import { evaluateDecision } from './loungeModerationConfig.js';
import { effectiveModerationConfig } from './loungeModerationState.js';
import { requestModeration } from './loungeModerationRequest.js';
import { claimJob, completeJob, failJob, getJobMessage, purgeModerationData, reconcileJobs, supersedeJob } from '#db/queries/loungeModeration';

export async function processModerationJob({ fetchImpl=fetch, config }={}) {
  config ??= await effectiveModerationConfig();
  if (!config.enabled) return false;
  const job = await claimJob();
  if (!job) return false;
  try {
    const message = await getJobMessage(job);
    if (!message) { await supersedeJob(job); return true; }
    const data = await requestModeration(message.body,{fetchImpl});
    const decision = evaluateDecision(data,config.thresholds,config.reviewMode);
    await completeJob(job,data,config.thresholds,decision.triggered,decision);
  } catch (error) {
    const safe = /^(API HTTP \d{3}|API network error or timeout|Invalid API JSON|Invalid moderation response|Invalid moderation scores)$/.test(error.message)
      ? error.message : 'Moderation processing failed';
    await failJob(job,safe);
  }
  return true;
}

export function startModerationProcessor() {
  let stopped=false, timer, lastPurge=0, lastReconcile=0;
  async function tick() {
    let worked=false;
    try {
      if (Date.now()-lastPurge>60*60*1000) { await purgeModerationData(); lastPurge=Date.now(); }
      const config=await effectiveModerationConfig();
      if (config.enabled) {
        if (Date.now()-lastReconcile>60_000) { await reconcileJobs(); lastReconcile=Date.now(); }
        // One request at a time per server. Database leases also protect multiple instances.
        // Re-read the Owner setting before each job; never cache it across cycles.
        worked=await processModerationJob();
      }
    } catch { console.error('Lounge moderation background cycle failed; retrying later.'); }
    if (!stopped) { timer=setTimeout(tick,worked?1000:15_000); timer.unref(); }
  }
  void tick();
  return () => { stopped=true; clearTimeout(timer); };
}
