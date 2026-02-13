import { v4 as uuidv4 } from 'uuid';

const AGT_BASE_URLS = [
  process.env.AGT_BASE_URL,
  'https://daily-cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://cloudcode-pa.googleapis.com'
].filter(Boolean);

const AGT_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const AGT_CLIENT_SECRET = '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';
const AGT_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AGT_DEFAULT_USER_AGENT = process.env.AGT_USER_AGENT || 'antigravity/1.104.0 darwin/arm64';
const AGT_API_CLIENT = 'google-cloud-sdk vscode_cloudshelleditor/0.1';
const AGT_CLIENT_METADATA = '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}';

const AGT_PATHS = {
  generate: '/v1internal:generateContent',
  stream: '/v1internal:streamGenerateContent',
  countTokens: '/v1internal:countTokens',
  fetchModels: '/v1internal:fetchAvailableModels',
  loadCodeAssist: '/v1internal:loadCodeAssist',
  onboardUser: '/v1internal:onboardUser'
};

const AGT_SKIP_INJECTION_PATHS = [
  '/v1internal:loadCodeAssist',
  '/v1internal:onboardUser',
  '/v1internal:fetchAvailableModels'
];

const AGT_MAX_RETRY = Math.max(Number.parseInt(process.env.AGT_REQUEST_RETRY || '1', 10) || 0, 0);

const AGT_EXCLUSIVE_MODELS = new Set([
  'gemini-3-pro-high',
  'gemini-3-pro-low',
  'gemini-3-pro-image',
  'gemini-3-flash',
  'gemini-2.5-flash',
  'claude-sonnet-4-5-thinking',
  'claude-opus-4-5-thinking',
  'claude-opus-4-6-thinking'
]);

const MODEL_ALIAS = {
  'antigravity-gemini-3-pro': 'gemini-3-pro-high',
  'antigravity-gemini-3-flash': 'gemini-3-flash',
  'antigravity-gemini-2-5-flash': 'gemini-2.5-flash',
  'antigravity-claude-sonnet-4-5': 'claude-sonnet-4-5',
  'antigravity-claude-sonnet-4-5-thinking': 'claude-sonnet-4-5-thinking',
  'antigravity-claude-opus-4-5-thinking': 'claude-opus-4-5-thinking',
  'antigravity-claude-opus-4-6-thinking': 'claude-opus-4-6-thinking',
  'gemini-3-pro-preview': 'gemini-3-pro-high',
  'gemini-3-flash-preview': 'gemini-3-flash',
  'gemini-claude-sonnet-4-5': 'claude-sonnet-4-5',
  'gemini-claude-sonnet-4-5-thinking': 'claude-sonnet-4-5-thinking',
  'gemini-claude-opus-4-5-thinking': 'claude-opus-4-5-thinking',
  'gemini-claude-opus-4-6-thinking': 'claude-opus-4-6-thinking'
};

export const AGT_STATIC_MODELS = [
  { id: 'antigravity-gemini-3-pro-high', upstream: 'gemini-3-pro-high', owned_by: 'antigravity', display_name: 'Antigravity Gemini 3 Pro High' },
  { id: 'antigravity-gemini-3-flash', upstream: 'gemini-3-flash', owned_by: 'antigravity', display_name: 'Antigravity Gemini 3 Flash' },
  { id: 'antigravity-claude-sonnet-4-5', upstream: 'claude-sonnet-4-5', owned_by: 'antigravity', display_name: 'Antigravity Claude Sonnet 4.5' },
  { id: 'antigravity-claude-sonnet-4-5-thinking', upstream: 'claude-sonnet-4-5-thinking', owned_by: 'antigravity', display_name: 'Antigravity Claude Sonnet 4.5 Thinking' },
  { id: 'antigravity-claude-opus-4-5-thinking', upstream: 'claude-opus-4-5-thinking', owned_by: 'antigravity', display_name: 'Antigravity Claude Opus 4.5 Thinking' },
  { id: 'antigravity-claude-opus-4-6-thinking', upstream: 'claude-opus-4-6-thinking', owned_by: 'antigravity', display_name: 'Antigravity Claude Opus 4.6 Thinking' }
];

export function isAntigravityModel(model) {
  const m = String(model || '').trim();
  if (!m) return false;
  
  // 1. With antigravity- prefix
  if (m.startsWith('antigravity-')) return true;
  
  // 2. In MODEL_ALIAS
  if (MODEL_ALIAS[m]) return true;
  
  // 3. AGT-exclusive models (no prefix)
  if (AGT_EXCLUSIVE_MODELS.has(m)) return true;
  
  return false;
}

export function resolveAntigravityUpstreamModel(model) {
  const m = String(model || '').trim();
  if (!m) return '';
  if (MODEL_ALIAS[m]) return MODEL_ALIAS[m];
  if (m.startsWith('antigravity-')) return m.replace(/^antigravity-/, '');
  return m;
}

function parseIsoTime(value) {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function shouldRetryNoCapacity(status, bodyText) {
  if (status !== 503) return false;
  const lower = String(bodyText || '').toLowerCase();
  return lower.includes('no capacity available');
}

function noCapacityDelay(attempt) {
  const delay = Math.min((attempt + 1) * 250, 2000);
  return delay;
}

function rateLimitDelay(attempt) {
  return Math.min(1000 * Math.pow(2, attempt), 4000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(max) {
  return Math.floor(Math.random() * Math.max(max, 1));
}

function generateProjectIdFallback() {
  const adjectives = ['useful', 'bright', 'swift', 'calm', 'bold'];
  const nouns = ['fuze', 'wave', 'spark', 'flow', 'core'];
  const suffix = uuidv4().replace(/-/g, '').slice(0, 5).toLowerCase();
  return `${adjectives[randomInt(adjectives.length)]}-${nouns[randomInt(nouns.length)]}-${suffix}`;
}

function generateSessionIdFallback() {
  const n = Math.floor(Math.random() * 9_000_000_000_000_000_000);
  return `-${n}`;
}

function generateStableSessionId(body) {
  // Try to extract user message content for stable session ID
  if (body && body.request && Array.isArray(body.request.contents)) {
    for (const content of body.request.contents) {
      if (content.role === 'user' && content.parts && content.parts[0] && content.parts[0].text) {
        const text = content.parts[0].text;
        // Simple hash: use first 16 chars of text to generate stable ID
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
          hash = ((hash << 5) - hash) + text.charCodeAt(i);
          hash = hash & hash; // Convert to 32bit integer
        }
        return `-${Math.abs(hash)}`;
      }
    }
  }
  return generateSessionIdFallback();
}

function buildAgtRequestBody(body, projectId, skipInjection = false) {
  const nextBody = body && typeof body === 'object' ? JSON.parse(JSON.stringify(body)) : {};

  // Skip field injection for specific endpoints
  if (skipInjection) {
    return nextBody;
  }

  const normalizedProject = String(projectId || '').trim() || generateProjectIdFallback();

  // Match CLIProxyAPI: inject all required fields
  if (!nextBody.model) {
    nextBody.model = '';
  }
  if (!nextBody.userAgent) {
    nextBody.userAgent = 'antigravity';
  }
  if (!nextBody.requestType) {
    nextBody.requestType = 'agent';
  }
  if (!nextBody.project) {
    nextBody.project = normalizedProject;
  }
  if (!nextBody.requestId) {
    nextBody.requestId = `agent-${uuidv4()}`;
  }
  if (!nextBody.request || typeof nextBody.request !== 'object') {
    nextBody.request = {};
  }
  if (!nextBody.request.sessionId) {
    nextBody.request.sessionId = generateStableSessionId(nextBody);
  }

  return nextBody;
}

function getAgtHeaders(token, accept = 'application/json') {
  return {
    'Content-Type': 'application/json',
    Accept: accept,
    Authorization: `Bearer ${token}`,
    'User-Agent': AGT_DEFAULT_USER_AGENT,
    'X-Goog-Api-Client': AGT_API_CLIENT,
    'Client-Metadata': AGT_CLIENT_METADATA
  };
}

function isTokenExpiringSoon(account) {
  const expiredAt = parseIsoTime(account.expired);
  if (!expiredAt) return true;
  return expiredAt - Date.now() < 5 * 60 * 1000;
}

async function refreshAccessToken(account) {
  const payload = new URLSearchParams({
    client_id: AGT_CLIENT_ID,
    client_secret: AGT_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: account.refresh_token
  });

  const response = await fetch(AGT_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload.toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AGT token refresh failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const now = Date.now();
  const expiresIn = Number(data.expires_in || account.expires_in || 0);
  const expired = expiresIn > 0 ? new Date(now + expiresIn * 1000).toISOString() : account.expired;

  return {
    access_token: data.access_token || account.access_token,
    refresh_token: data.refresh_token || account.refresh_token,
    expires_in: expiresIn,
    expired,
    timestamp: now
  };
}

async function probeProjectId(token) {
  const payload = {
    metadata: {
      ideType: 'ANTIGRAVITY',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI'
    }
  };

  const result = await requestJsonWithFallback(token, AGT_PATHS.loadCodeAssist, payload);
  let projectId = result?.cloudaicompanionProject?.id || result?.cloudaicompanionProject || '';

  if (!projectId) {
    const tiers = Array.isArray(result?.allowedTiers) ? result.allowedTiers : [];
    let tierId = 'legacy-tier';
    for (const tier of tiers) {
      if (tier?.isDefault && typeof tier?.id === 'string' && tier.id.trim()) {
        tierId = tier.id.trim();
        break;
      }
    }

    projectId = await onboardProjectId(token, tierId);
  }

  return projectId || null;
}

async function onboardProjectId(token, tierId) {
  const payload = {
    tierId: tierId || 'legacy-tier',
    metadata: {
      ideType: 'ANTIGRAVITY',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI'
    }
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    const data = await requestJsonWithFallback(token, AGT_PATHS.onboardUser, payload);
    if (data?.done === true) {
      const project = data?.response?.cloudaicompanionProject;
      const projectId = typeof project === 'string' ? project : project?.id;
      if (typeof projectId === 'string' && projectId.trim()) {
        return projectId.trim();
      }
      return null;
    }
    await sleep(2000);
  }

  return null;
}

async function ensureProjectId(db, account, token) {
  if (account.project_id) return account.project_id;

  try {
    const projectId = await probeProjectId(token);
    if (!projectId) return null;

    db.updateAgtAccountTokens(account.id, {
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      expires_in: account.expires_in,
      expired: account.expired,
      timestamp: account.timestamp,
      project_id: projectId,
      email: account.email
    });

    return projectId;
  } catch {
    return null;
  }
}

export async function ensureAntigravityAccessToken(db, account) {
  if (!account) throw new Error('AGT account missing');
  if (account.access_token && !isTokenExpiringSoon(account)) {
    await ensureProjectId(db, account, account.access_token);
    return account.access_token;
  }

  const nextTokens = await refreshAccessToken(account);
  db.updateAgtAccountTokens(account.id, {
    ...nextTokens,
    project_id: account.project_id,
    email: account.email
  });

  await ensureProjectId(db, {
    ...account,
    ...nextTokens
  }, nextTokens.access_token);

  return nextTokens.access_token;
}

function buildAgtUrl(baseUrl, path) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

async function requestWithFallback(token, path, body, options = {}) {
  const isStream = options.stream === true;
  const accept = options.accept || (isStream ? 'text/event-stream' : 'application/json');
  const baseUrls = AGT_BASE_URLS.length > 0 ? AGT_BASE_URLS : ['https://daily-cloudcode-pa.googleapis.com'];

  for (let attempt = 0; attempt <= AGT_MAX_RETRY; attempt++) {
    let shouldRetryAttempt = false;

    for (let index = 0; index < baseUrls.length; index++) {
      const baseUrl = baseUrls[index];
      let response;
      try {
        response = await fetch(buildAgtUrl(baseUrl, path), {
          method: 'POST',
          headers: getAgtHeaders(token, accept),
          body: JSON.stringify(body)
        });
      } catch (error) {
        if (index + 1 < baseUrls.length) {
          continue;
        }
        throw error;
      }

      if (response.ok) {
        return response;
      }

      const bodyText = await response.text();

      if (response.status === 429) {
        if (index + 1 < baseUrls.length) {
          continue;
        }
        if (attempt < AGT_MAX_RETRY) {
          shouldRetryAttempt = true;
          await sleep(rateLimitDelay(attempt));
          break;
        }
      }

      if (shouldRetryNoCapacity(response.status, bodyText)) {
        if (index + 1 < baseUrls.length) {
          continue;
        }
        if (attempt < AGT_MAX_RETRY) {
          shouldRetryAttempt = true;
          await sleep(noCapacityDelay(attempt));
          break;
        }
      }

      const error = new Error(`AGT upstream error (${response.status}): ${bodyText}`);
      error.status = response.status;
      error.body = bodyText;
      throw error;
    }

    if (!shouldRetryAttempt) {
      break;
    }
  }

  throw new Error('AGT upstream unavailable');
}

async function requestJsonWithFallback(token, path, body) {
  const response = await requestWithFallback(token, path, body, { stream: false, accept: 'application/json' });
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  const parsed = parseJsonSafe(text);
  if (!parsed) {
    throw new Error(`AGT upstream returned invalid JSON on ${path}`);
  }
  return parsed;
}

export async function callAntigravity(db, account, path, body) {
  const token = await ensureAntigravityAccessToken(db, account);
  const latest = db.getAgtAccountById(account.id) || account;
  const skipInjection = AGT_SKIP_INJECTION_PATHS.includes(path);
  const payload = buildAgtRequestBody(body || {}, latest.project_id, skipInjection);
  return requestJsonWithFallback(token, path, payload);
}

export async function callAntigravityStream(db, account, path, body) {
  const token = await ensureAntigravityAccessToken(db, account);
  const latest = db.getAgtAccountById(account.id) || account;
  const skipInjection = AGT_SKIP_INJECTION_PATHS.includes(path);
  const payload = buildAgtRequestBody(body || {}, latest.project_id, skipInjection);
  return requestWithFallback(token, path, payload, { stream: true, accept: 'text/event-stream' });
}

function toAgtParts(content) {
  if (typeof content === 'string') {
    return content ? [{ text: content }] : [];
  }
  if (Array.isArray(content)) {
    const parts = [];
    for (const item of content) {
      if (item?.type === 'text' && item.text) {
        parts.push({ text: item.text });
      }
    }
    return parts;
  }
  return [];
}

export function convertOpenAIToAgtPayload(body, model) {
  const contents = [];
  const systemParts = [];

  for (const message of body.messages || []) {
    const role = message.role;
    if (role === 'system' || role === 'developer') {
      const parts = toAgtParts(message.content);
      systemParts.push(...parts);
      continue;
    }

    const mappedRole = role === 'assistant' ? 'model' : 'user';
    const parts = toAgtParts(message.content);
    if (parts.length > 0) {
      contents.push({ role: mappedRole, parts });
    }
  }

  const payload = {
    project: '',
    model: resolveAntigravityUpstreamModel(model),
    request: {
      contents,
      generationConfig: {}
    }
  };

  if (systemParts.length > 0) {
    payload.request.systemInstruction = { role: 'user', parts: systemParts };
  }
  if (typeof body.temperature === 'number') payload.request.generationConfig.temperature = body.temperature;
  if (typeof body.top_p === 'number') payload.request.generationConfig.topP = body.top_p;
  if (typeof body.max_tokens === 'number') payload.request.generationConfig.maxOutputTokens = body.max_tokens;

  return payload;
}

export function convertClaudeToAgtPayload(body, model) {
  const contents = [];
  const systemParts = [];

  if (typeof body.system === 'string' && body.system) {
    systemParts.push({ text: body.system });
  } else if (Array.isArray(body.system)) {
    for (const item of body.system) {
      if (item?.type === 'text' && item.text) systemParts.push({ text: item.text });
    }
  }

  for (const message of body.messages || []) {
    const mappedRole = message.role === 'assistant' ? 'model' : 'user';
    const parts = toAgtParts(message.content);
    if (parts.length > 0) {
      contents.push({ role: mappedRole, parts });
    }
  }

  const payload = {
    project: '',
    model: resolveAntigravityUpstreamModel(model),
    request: {
      contents,
      generationConfig: {}
    }
  };

  if (systemParts.length > 0) {
    payload.request.systemInstruction = { role: 'user', parts: systemParts };
  }
  if (typeof body.temperature === 'number') payload.request.generationConfig.temperature = body.temperature;
  if (typeof body.top_p === 'number') payload.request.generationConfig.topP = body.top_p;
  if (typeof body.max_tokens === 'number') payload.request.generationConfig.maxOutputTokens = body.max_tokens;

  return payload;
}

function getAgtResponseRoot(payload) {
  return payload?.response || payload;
}

function extractParts(payload) {
  const root = getAgtResponseRoot(payload);
  return root?.candidates?.[0]?.content?.parts || [];
}

function extractText(parts) {
  return parts
    .filter((part) => typeof part?.text === 'string' && part.text.length > 0)
    .map((part) => part.text)
    .join('');
}

function extractUsage(payload) {
  const root = getAgtResponseRoot(payload);
  const usage = root?.usageMetadata || payload?.usageMetadata || {};
  const input = Number(usage.promptTokenCount || 0);
  const output = Number(usage.candidatesTokenCount || 0);
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: Number(usage.totalTokenCount || input + output)
  };
}

export function convertAgtToOpenAI(payload, model) {
  const parts = extractParts(payload);
  const content = extractText(parts);
  const usage = extractUsage(payload);

  return {
    id: `chatcmpl_${uuidv4().replace(/-/g, '')}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop'
      }
    ],
    usage: {
      prompt_tokens: usage.input_tokens,
      completion_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens
    }
  };
}

export function convertAgtToClaude(payload, model) {
  const parts = extractParts(payload);
  const usage = extractUsage(payload);
  const content = extractText(parts);

  return {
    id: `msg_${uuidv4().replace(/-/g, '')}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: content }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens
    }
  };
}

export async function fetchAntigravityModels(db, account) {
  const result = await callAntigravity(db, account, AGT_PATHS.fetchModels, {});
  const models = result?.models || {};
  return Object.keys(models);
}

export async function fetchAntigravityModelsWithMeta(db, account) {
  const result = await callAntigravity(db, account, AGT_PATHS.fetchModels, {});
  return result?.models || {};
}

export function normalizeImportedAgtAccount(raw, index = 0) {
  const now = Date.now();
  const email = String(raw?.email || '').trim();
  const refreshToken = String(raw?.refresh_token || '').trim();
  if (!refreshToken) throw new Error('Missing refresh_token');

  return {
    id: `agt_${uuidv4()}`,
    name: email || `antigravity-${index + 1}`,
    email: email || null,
    project_id: raw?.project_id || null,
    access_token: raw?.access_token || null,
    refresh_token: refreshToken,
    expires_in: raw?.expires_in || null,
    expired: raw?.expired || null,
    timestamp: raw?.timestamp || now,
    type: 'antigravity',
    status: 'active',
    request_count: 0,
    error_count: 0,
    created_at: new Date(now).toISOString(),
    last_used_at: null,
    updated_at: new Date(now).toISOString()
  };
}
