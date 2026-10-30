import { getModerationSettings } from '#db/queries/loungeModerationSettings';
import { moderationConfig } from '#utils/loungeModerationConfig';

export async function effectiveModerationConfig() {
  const config=moderationConfig();
  const settings=await getModerationSettings();
  return {...config,enabled:config.enabled&&settings.enabled,ownerEnabled:settings.enabled,
    settingsRevision:settings.revision,updatedAt:settings.updated_at,updatedByUsername:settings.updated_by_username};
}

export function publicModerationState(config) {
  const {mode,enabled,keyConfigured,error,ownerEnabled,settingsRevision,updatedAt,updatedByUsername}=config;
  return {mode,enabled,keyConfigured,error,ownerEnabled,settingsRevision,updatedAt,updatedByUsername};
}
