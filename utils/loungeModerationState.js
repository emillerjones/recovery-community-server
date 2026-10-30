import { getModerationSettings } from '#db/queries/loungeModerationSettings';
import { moderationConfig, validateThresholds, DEFAULT_THRESHOLDS } from '#utils/loungeModerationConfig';
import { MODERATION_CATEGORIES } from '#utils/loungeModerationCategories';

export async function effectiveModerationConfig() {
  const config=moderationConfig();
  const settings=await getModerationSettings();
  let error=config.error;
  let savedThresholds={};
  try{savedThresholds=validateThresholds(settings.thresholds);}catch{error='Saved moderation thresholds are invalid. Processing is disabled.';}
  return {...config,error,thresholds:{...DEFAULT_THRESHOLDS,...savedThresholds,...config.thresholdOverrides},
    savedThresholds,thresholdRevision:settings.threshold_revision,
    thresholdsUpdatedAt:settings.thresholds_updated_at,thresholdsUpdatedByUsername:settings.thresholds_updated_by_username,
    enabled:!error&&config.enabled&&settings.enabled,ownerEnabled:settings.enabled,
    settingsRevision:settings.revision,updatedAt:settings.updated_at,updatedByUsername:settings.updated_by_username};
}

export function thresholdConfiguration(config) {
  return {revision:config.thresholdRevision,updatedAt:config.thresholdsUpdatedAt,updatedByUsername:config.thresholdsUpdatedByUsername,
    categories:MODERATION_CATEGORIES.map(category=>({...category,value:config.thresholds[category.key],
      defaultValue:DEFAULT_THRESHOLDS[category.key],
      source:Object.hasOwn(config.thresholdOverrides,category.key)?'render':Object.hasOwn(config.savedThresholds,category.key)?'owner':'default'})),
    error:config.error};
}

export function publicModerationState(config) {
  const {mode,enabled,keyConfigured,error,ownerEnabled,settingsRevision,updatedAt,updatedByUsername}=config;
  return {mode,enabled,keyConfigured,error,ownerEnabled,settingsRevision,updatedAt,updatedByUsername};
}
