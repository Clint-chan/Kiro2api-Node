/**
 * 智能模型路由
 * 根据账号池能力自动选择最优渠道
 */

import { isAntigravityModel } from './antigravity.js';
import { isCodexModel } from './codex.js';
import fs from 'fs';

/**
 * Opus 模型需要 Pro 或更高级别的 Kiro 账号
 */
const OPUS_MODELS = new Set([
  'claude-opus-4-5',
  'claude-opus-4-5-20251101',
  'claude-opus-4-6',
  'claude-opus-4.5',
  'claude-opus-4.6'
]);

/**
 * 模型到 Antigravity 的映射（fallback）
 * 注：Claude Opus 4.5 已不可用，已升级至 Opus 4.6
 */
const KIRO_TO_ANTIGRAVITY_FALLBACK = {
  'claude-opus-4-5': 'claude-opus-4-6-thinking',
  'claude-opus-4-5-20251101': 'claude-opus-4-6-thinking',
  'claude-opus-4-6': 'claude-opus-4-6-thinking'
};

/**
 * 检查用户是否有 Antigravity 权限
 */
function hasAntigravityPermission(user) {
  if (!user || !user.allowed_channels) {
    console.log('[hasAntigravityPermission] No user or allowed_channels:', { user: !!user, allowed_channels: user?.allowed_channels });
    return false;
  }

  let channels;
  if (Array.isArray(user.allowed_channels)) {
    channels = user.allowed_channels;
  } else if (typeof user.allowed_channels === 'string') {
    try {
      const parsed = JSON.parse(user.allowed_channels);
      channels = Array.isArray(parsed) ? parsed : [user.allowed_channels];
    } catch {
      channels = String(user.allowed_channels).split(',').map(c => c.trim());
    }
  } else {
    return false;
  }

  const hasPermission = channels.includes('antigravity');
  console.log('[hasAntigravityPermission] Channels:', channels, 'Has permission:', hasPermission);
  return hasPermission;
}

/**
 * 检查模型是否需要 Pro 级别账号
 */
export function requiresProAccount(model) {
  const normalized = String(model || '').toLowerCase();
  return OPUS_MODELS.has(model) || normalized.includes('opus');
}

/**
 * 检查 Kiro 账号池是否有支持该模型的账号
 */
export function hasKiroAccountForModel(accountPool, model) {
  if (!requiresProAccount(model)) {
    // Sonnet/Haiku 模型，free 账号即可
    return true;
  }

  // Opus 模型需要检查是否有 Pro/Team 账号
  const accounts = Array.from(accountPool.accounts.values());
  const eligibleAccounts = accounts.filter(account => {
    if (account.status !== 'active') return false;
    
    const subscriptionType = account.usage?.subscriptionType;
    // Pro 或 Team 账号可以使用 Opus
    return subscriptionType === 'PRO' || subscriptionType === 'TEAM';
  });

  return eligibleAccounts.length > 0;
}

/**
 * 智能路由：决定使用哪个渠道
 * @param {string} model - 模型名称
 * @param {object} accountPool - 账号池对象
 * @param {object} user - 用户对象（用于权限检查）
 * @returns {object} { channel: 'kiro'|'antigravity'|'codex', model: string, reason: string }
 */
export function routeModel(model, accountPool, user = null) {
  // 1. 如果已经是 Antigravity 专属模型，直接使用 Antigravity
  if (isAntigravityModel(model)) {
    return {
      channel: 'antigravity',
      model: model,
      reason: 'antigravity_exclusive'
    };
  }

  // 1.5. Codex 模型直接使用 codex channel
  if (isCodexModel(model)) {
    return {
      channel: 'codex',
      model: model,
      reason: 'codex_model'
    };
  }

  // 2. 如果不需要 Pro 账号（Sonnet/Haiku），优先使用 Kiro
  if (!requiresProAccount(model)) {
    return {
      channel: 'kiro',
      model: model,
      reason: 'kiro_free_supported'
    };
  }

  // 3. Opus 模型：检查 Kiro 是否有 Pro 账号
  if (hasKiroAccountForModel(accountPool, model)) {
    return {
      channel: 'kiro',
      model: model,
      reason: 'kiro_pro_available'
    };
  }

  // 4. Kiro 没有 Pro 账号，fallback 到 Antigravity
  // 检查用户是否有 Antigravity 权限
  fs.appendFileSync('./logs/debug.log', `[routeModel] User: ${user?.username}, allowed_channels: ${user?.allowed_channels}\n`);
  
  const hasPermission = hasAntigravityPermission(user);
  fs.appendFileSync('./logs/debug.log', `[routeModel] hasPermission result: ${hasPermission}\n`);
  
  if (!user || !hasPermission) {
    fs.appendFileSync('./logs/debug.log', `[routeModel] Permission denied\n`);
    return {
      channel: 'kiro',
      model: model,
      reason: 'kiro_pro_unavailable_fallback',
      error: 'User does not have Antigravity permission'
    };
  }

  const antigravityModel = KIRO_TO_ANTIGRAVITY_FALLBACK[model] || `${model}-thinking`;
  return {
    channel: 'antigravity',
    model: antigravityModel,
    reason: 'kiro_pro_unavailable_fallback'
  };
}

/**
 * 获取模型的渠道（兼容旧接口）
 */
export function resolveModelChannel(model, accountPool) {
  const route = routeModel(model, accountPool);
  return route.channel;
}
