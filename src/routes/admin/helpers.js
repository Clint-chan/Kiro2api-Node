export function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function toStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item || '').trim())
          .filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return [];
}

export function normalizeUserPermissions(channelsRaw, modelsRaw) {
  const allowedChannels = toStringArray(channelsRaw);
  const validChannels = ['kiro', 'antigravity', 'codex'];
  const normalizedChannels = allowedChannels.filter((channel) => validChannels.includes(channel));
  const nextChannels = normalizedChannels.length > 0 ? normalizedChannels : ['kiro'];

  const allowedModels = toStringArray(modelsRaw);
  return {
    allowed_channels: Array.from(new Set(nextChannels)),
    allowed_models: allowedModels.length > 0 ? Array.from(new Set(allowedModels)) : []
  };
}

export function serializeUser(user) {
  return {
    ...user,
    allowed_channels: toStringArray(user.allowed_channels).length > 0 ? toStringArray(user.allowed_channels) : ['kiro'],
    allowed_models: toStringArray(user.allowed_models)
  };
}

export function normalizeAntigravityTier(usage) {
  const paidTier = usage?.paidTier?.id || usage?.paidTier || null;
  const currentTier = usage?.currentTier?.id || usage?.currentTier || null;
  return {
    paid_tier: typeof paidTier === 'string' ? paidTier : null,
    plan_tier: typeof currentTier === 'string' ? currentTier : null
  };
}

export function extractQuotaMeta(modelsMap) {
  const quotaByModel = {};
  let nextReset = null;
  let nextResetTs = Number.POSITIVE_INFINITY;

  const allowedModels = new Set([
    'gemini-3-pro-high',
    'gemini-3-flash',
    'claude-sonnet-4-5',
    'claude-sonnet-4-5-thinking',
    'claude-opus-4-5-thinking',
    'claude-opus-4-6-thinking'
  ]);

  for (const [model, modelData] of Object.entries(modelsMap || {})) {
    if (!allowedModels.has(model)) {
      continue;
    }

    const info = modelData?.quotaInfo;
    if (!info) continue;

    const remainingFraction = typeof info.remainingFraction === 'number' ? info.remainingFraction : null;
    const resetTime = typeof info.resetTime === 'string' ? info.resetTime : null;

    quotaByModel[model] = {
      remaining_fraction: remainingFraction,
      reset_time: resetTime
    };

    if (resetTime) {
      const ts = Date.parse(resetTime);
      if (Number.isFinite(ts) && ts < nextResetTs) {
        nextResetTs = ts;
        nextReset = resetTime;
      }
    }
  }

  return {
    model_quotas: Object.keys(quotaByModel).length > 0 ? JSON.stringify(quotaByModel) : null,
    next_reset: nextReset
  };
}
