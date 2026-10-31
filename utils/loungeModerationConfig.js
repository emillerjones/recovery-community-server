export const DEFAULT_THRESHOLDS = Object.freeze({
  sexual: 0.95, 'sexual/minors': 0.8, harassment: 0.95,
  'harassment/threatening': 0.9, hate: 0.95, 'hate/threatening': 0.9,
  illicit: 0.98, 'illicit/violent': 0.95, 'self-harm': 0.98,
  'self-harm/intent': 0.95, 'self-harm/instructions': 0.9,
  violence: 0.98, 'violence/graphic': 0.95,
});

export function validateThresholds(overrides) {
  if (!overrides || Array.isArray(overrides) || typeof overrides !== 'object') throw new Error('Invalid thresholds');
  for (const [key,value] of Object.entries(overrides)) {
    if (!Object.hasOwn(DEFAULT_THRESHOLDS,key)||typeof value!=='number'||!Number.isFinite(value)||value<0||value>1) throw new Error('Invalid threshold');
  }
  return overrides;
}

export function moderationConfig(env = process.env) {
  const mode = env.LOUNGE_MODERATION_MODE || 'off';
  let thresholds = { ...DEFAULT_THRESHOLDS };
  let thresholdOverrides = {};
  let error = null;
  try {
    if (!['off', 'testing'].includes(mode)) throw new Error('Invalid mode');
    thresholdOverrides = validateThresholds(JSON.parse(env.LOUNGE_MODERATION_THRESHOLDS || '{}'));
    thresholds = {...thresholds,...thresholdOverrides};
  } catch { error = 'Invalid Lounge moderation configuration. Processing is disabled.'; }
  return { mode, thresholds, thresholdOverrides, error, enabled: !error && mode === 'testing' && Boolean(env.OPENAI_API_KEY), keyConfigured: Boolean(env.OPENAI_API_KEY) };
}

export function evaluateResponse(response, thresholds) {
  const result = response?.results?.[0];
  if (response?.results?.length !== 1 || typeof response.model !== 'string' || !result?.category_scores) throw new Error('Invalid moderation response');
  for (const category of Object.keys(thresholds)) {
    const score = result.category_scores[category];
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) throw new Error('Invalid moderation scores');
  }
  return Object.entries(thresholds).filter(([category, threshold]) => result.category_scores[category] >= threshold).map(([category]) => category);
}

export const REVIEW_MODES = Object.freeze(['cutoffs','openai','either']);

export function evaluateDecision(response, thresholds, reviewMode='cutoffs') {
  if (!REVIEW_MODES.includes(reviewMode)) throw new Error('Invalid moderation response');
  const triggered = evaluateResponse(response, thresholds);
  if (typeof response.results[0].flagged !== 'boolean') throw new Error('Invalid moderation response');
  const reasons = [];
  if (reviewMode !== 'openai' && triggered.length) reasons.push('cutoffs');
  if (reviewMode !== 'cutoffs' && response.results[0].flagged) reasons.push('openai');
  return { reviewMode, triggered, reasons, needsReview: reasons.length > 0 };
}
