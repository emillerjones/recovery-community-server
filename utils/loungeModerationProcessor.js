import { moderationConfig, evaluateResponse } from './loungeModerationConfig.js';
import { claimJob, completeJob, failJob, getJobMessage, purgeModerationData, reconcileJobs, supersedeJob } from '#db/queries/loungeModeration';

export async function processModerationJob({ fetchImpl=fetch, config=moderationConfig() }={}) {
  if (!config.enabled) return false;
  const job = await claimJob();
  if (!job) return false;
  try {
    const message = await getJobMessage(job);
    if (!message) { await supersedeJob(job); return true; }
    let response;
    try {
      response = await fetchImpl('https://api.openai.com/v1/moderations', {
        method:'POST', headers:{ Authorization:`Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type':'application/json' },
        body:JSON.stringify({ model:'omni-moderation-latest', input:message.body }), signal:AbortSignal.timeout(20_000),
      });
    } catch { throw new Error('API network error or timeout'); }
    if (!response.ok) throw new Error(`API HTTP ${response.status}`);
    let data;
    try { data = await response.json(); } catch { throw new Error('Invalid API JSON'); }
    const triggered = evaluateResponse(data,config.thresholds);
    await completeJob(job,data,config.thresholds,triggered);
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
      const config=moderationConfig();
      if (config.enabled) {
        if (Date.now()-lastReconcile>60_000) { await reconcileJobs(); lastReconcile=Date.now(); }
        // One request at a time per server. Database leases also protect multiple instances.
        worked=await processModerationJob({config});
      }
    } catch { console.error('Lounge moderation background cycle failed; retrying later.'); }
    if (!stopped) { timer=setTimeout(tick,worked?1000:15_000); timer.unref(); }
  }
  void tick();
  return () => { stopped=true; clearTimeout(timer); };
}
