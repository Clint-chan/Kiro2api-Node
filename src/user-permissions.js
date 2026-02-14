const DEFAULT_CHANNELS = ['kiro'];

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return null;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeStringArray(list) {
  if (!Array.isArray(list)) return [];
  return Array.from(new Set(list
    .map((item) => String(item || '').trim())
    .filter(Boolean)));
}

export function getAllowedChannels(user) {
  const channels = normalizeStringArray(parseJsonArray(user?.allowed_channels));
  if (channels.length === 0) return [...DEFAULT_CHANNELS];
  return channels;
}

export function getAllowedModels(user) {
  return normalizeStringArray(parseJsonArray(user?.allowed_models));
}

export function isChannelAllowed(user, channel) {
  const normalizedChannel = String(channel || '').trim();
  if (!normalizedChannel) return false;
  
  const allowedChannels = getAllowedChannels(user);
  
  // 'agt' 和 'antigravity' 是同义词
  if (normalizedChannel === 'agt' || normalizedChannel === 'antigravity') {
    return allowedChannels.includes('agt') || allowedChannels.includes('antigravity');
  }
  
  return allowedChannels.includes(normalizedChannel);
}

export function isModelAllowed(user, model) {
  const normalizedModel = String(model || '').trim();
  if (!normalizedModel) return false;

  const allowedModels = getAllowedModels(user);
  if (allowedModels.length === 0) return true;
  return allowedModels.includes(normalizedModel);
}

export function canAccessModel(user, model, channel) {
  if (!isChannelAllowed(user, channel)) {
    return {
      allowed: false,
      error: {
        type: 'permission_error',
        message: `Channel '${channel}' is not enabled for this API key.`
      }
    };
  }

  if (!isModelAllowed(user, model)) {
    return {
      allowed: false,
      error: {
        type: 'permission_error',
        message: `Model '${model}' is not allowed for this API key.`
      }
    };
  }

  return { allowed: true };
}

export function filterModelsByPermission(user, models, resolveChannel) {
  return (models || []).filter((model) => {
    const id = typeof model === 'string' ? model : model?.id;
    if (!id) return false;
    const channel = resolveChannel(id);
    return isChannelAllowed(user, channel) && isModelAllowed(user, id);
  });
}
