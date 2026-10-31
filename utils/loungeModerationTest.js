import { effectiveModerationConfig } from '#utils/loungeModerationState';
import { evaluateDecision } from '#utils/loungeModerationConfig';
import { requestModeration } from '#utils/loungeModerationRequest';

// No message, job, report-card, or audit writes: this result lives only in memory.
export async function testModeration(text) {
  const config=await effectiveModerationConfig();
  if(!config.enabled)return {unavailable:true};
  const response=await requestModeration(text);
  const decision=evaluateDecision(response,config.thresholds,config.reviewMode);
  return {response,thresholds_used:config.thresholds,review_mode:decision.reviewMode,
    triggered_categories:decision.triggered,review_reasons:decision.reasons,
    needs_review:decision.needsReview,checked_at:new Date().toISOString(),
    threshold_revision:config.thresholdRevision,review_mode_revision:config.reviewModeRevision};
}
