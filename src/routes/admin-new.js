import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { TokenManager } from '../token.js';
import {
  callAntigravity,
  fetchAntigravityModelsWithMeta,
  normalizeImportedAgtAccount
} from '../antigravity.js';

/**
 * Admin API Routes
 * Handles all administrative operations
 */
export function createAdminRouter(db, billing, subscription, accountPool) {
  const router = express.Router();

  function parseJsonSafe(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function toStringArray(value) {
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

  function normalizeUserPermissions(channelsRaw, modelsRaw) {
    const allowedChannels = toStringArray(channelsRaw);
    const validChannels = ['kiro', 'agt'];
    const normalizedChannels = allowedChannels.filter((channel) => validChannels.includes(channel));
    const nextChannels = normalizedChannels.length > 0 ? normalizedChannels : ['kiro'];

    const allowedModels = toStringArray(modelsRaw);
    return {
      allowed_channels: JSON.stringify(Array.from(new Set(nextChannels))),
      allowed_models: allowedModels.length > 0 ? JSON.stringify(Array.from(new Set(allowedModels))) : null
    };
  }

  function serializeUser(user) {
    return {
      ...user,
      allowed_channels: toStringArray(user.allowed_channels).length > 0 ? toStringArray(user.allowed_channels) : ['kiro'],
      allowed_models: toStringArray(user.allowed_models)
    };
  }

  function normalizeAgtTier(usage) {
    const paidTier = usage?.paidTier?.id || usage?.paidTier || null;
    const currentTier = usage?.currentTier?.id || usage?.currentTier || null;
    return {
      paid_tier: typeof paidTier === 'string' ? paidTier : null,
      plan_tier: typeof currentTier === 'string' ? currentTier : null
    };
  }

  function extractQuotaMeta(modelsMap) {
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

  // ==================== User Management ====================

  /**
   * GET /api/admin/users
   * Get all users
   */
  router.get('/users', (req, res) => {
    try {
      const { status, role } = req.query;

      let users = db.getAllUsers(status);

      if (role) {
        users = users.filter(u => u.role === role);
      }

      // Remove sensitive data
      const sanitizedUsers = users.map((user) => serializeUser({
        id: user.id,
        username: user.username,
        api_key: user.api_key,
        role: user.role,
        balance: user.balance,
        status: user.status,
        price_input: user.price_input,
        price_output: user.price_output,
        total_requests: user.total_requests,
        total_input_tokens: user.total_input_tokens,
        total_output_tokens: user.total_output_tokens,
        total_cost: user.total_cost,
        created_at: user.created_at,
        updated_at: user.updated_at,
        last_used_at: user.last_used_at,
        notes: user.notes,
        allowed_channels: user.allowed_channels,
        allowed_models: user.allowed_models
      }));

      res.json({
        success: true,
        data: sanitizedUsers,
        count: sanitizedUsers.length
      });
    } catch (error) {
      console.error('Get users error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve users.'
        }
      });
    }
  });

  /**
   * POST /api/admin/users
   * Create new user
   */
  router.post('/users', (req, res) => {
    try {
      let { username, api_key, role, balance, price_input, price_output, notes } = req.body;
      const permissions = normalizeUserPermissions(req.body.allowed_channels, req.body.allowed_models);

      // 如果没有提供用户名，自动生成
      if (!username) {
        const randomStr = Math.random().toString(36).substring(2, 8);
        username = `user_${randomStr}`;
      }

      // Generate API key if not provided
      const userApiKey = api_key || `sk-${uuidv4()}`;

      // Check if API key already exists
      const existingUser = db.getUserByApiKey(userApiKey);
      if (existingUser) {
        return res.status(400).json({
          error: {
            type: 'validation_error',
            message: 'API key already exists.'
          }
        });
      }

      const userId = uuidv4();
      const userData = {
        id: userId,
        username,
        api_key: userApiKey,
        role: role || 'user',
        balance: balance || 0.0,
        status: 'active',
        price_input: price_input || 3.0,
        price_output: price_output || 15.0,
        notes: notes || null,
        allowed_channels: parseJsonSafe(permissions.allowed_channels),
        allowed_models: parseJsonSafe(permissions.allowed_models)
      };

      db.createUser(userData);

      const user = db.getUserById(userId);

      res.status(201).json({
        success: true,
        data: serializeUser({
          id: user.id,
          username: user.username,
          api_key: user.api_key,
          role: user.role,
          balance: user.balance,
          status: user.status,
          price_input: user.price_input,
          price_output: user.price_output,
          allowed_channels: user.allowed_channels,
          allowed_models: user.allowed_models,
          created_at: user.created_at
        })
      });
    } catch (error) {
      console.error('Create user error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to create user.'
        }
      });
    }
  });

  /**
   * GET /api/admin/users/:id
   * Get user details
   */
  router.get('/users/:id', (req, res) => {
    try {
      const user = db.getUserById(req.params.id);

      if (!user) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'User not found.'
          }
        });
      }

      res.json({
        success: true,
        data: serializeUser({
          id: user.id,
          username: user.username,
          api_key: user.api_key,
          role: user.role,
          balance: user.balance,
          status: user.status,
          price_input: user.price_input,
          price_output: user.price_output,
          total_requests: user.total_requests,
          total_input_tokens: user.total_input_tokens,
          total_output_tokens: user.total_output_tokens,
          total_cost: user.total_cost,
          created_at: user.created_at,
          updated_at: user.updated_at,
          last_used_at: user.last_used_at,
          notes: user.notes,
          allowed_channels: user.allowed_channels,
          allowed_models: user.allowed_models
        })
      });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve user.'
        }
      });
    }
  });

  /**
   * PUT /api/admin/users/:id
   * Update user
   */
  router.put('/users/:id', (req, res) => {
    try {
      const user = db.getUserById(req.params.id);

      if (!user) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'User not found.'
          }
        });
      }

      const allowedUpdates = {
        username: req.body.username,
        balance: req.body.balance,
        status: req.body.status,
        role: req.body.role,
        price_input: req.body.price_input,
        price_output: req.body.price_output,
        notes: req.body.notes
      };

      if (req.body.allowed_channels !== undefined || req.body.allowed_models !== undefined) {
        const permissions = normalizeUserPermissions(req.body.allowed_channels, req.body.allowed_models);
        allowedUpdates.allowed_channels = permissions.allowed_channels;
        allowedUpdates.allowed_models = permissions.allowed_models;
      }

      // Remove undefined values
      const updates = {};
      for (const [key, value] of Object.entries(allowedUpdates)) {
        if (value !== undefined) {
          updates[key] = value;
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          error: {
            type: 'validation_error',
            message: 'No valid fields to update.'
          }
        });
      }

      db.updateUser(req.params.id, updates);

      const updatedUser = db.getUserById(req.params.id);

      res.json({
        success: true,
        data: serializeUser({
          id: updatedUser.id,
          username: updatedUser.username,
          api_key: updatedUser.api_key,
          role: updatedUser.role,
          balance: updatedUser.balance,
          status: updatedUser.status,
          price_input: updatedUser.price_input,
          price_output: updatedUser.price_output,
          allowed_channels: updatedUser.allowed_channels,
          allowed_models: updatedUser.allowed_models,
          updated_at: updatedUser.updated_at
        })
      });
    } catch (error) {
      console.error('Update user error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to update user.'
        }
      });
    }
  });

  /**
   * DELETE /api/admin/users/:id
   * Delete user
   */
  router.delete('/users/:id', (req, res) => {
    try {
      const user = db.getUserById(req.params.id);

      if (!user) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'User not found.'
          }
        });
      }

      db.deleteUser(req.params.id);

      res.json({
        success: true,
        message: 'User deleted successfully.'
      });
    } catch (error) {
      console.error('Delete user error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to delete user.'
        }
      });
    }
  });

  /**
   * POST /api/admin/users/:id/recharge
   * Adjust user balance (increase or decrease)
   */
  router.post('/users/:id/recharge', (req, res) => {
    try {
      const { amount, notes } = req.body;
      const numericAmount = Number(amount);

      if (!Number.isFinite(numericAmount) || numericAmount === 0) {
        return res.status(400).json({
          error: {
            type: 'validation_error',
            message: 'Valid non-zero amount is required.'
          }
        });
      }

      const user = db.getUserById(req.params.id);
      if (!user) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'User not found.'
          }
        });
      }

      const result = billing.recharge(
        req.params.id,
        numericAmount,
        req.admin.id,
        notes
      );

      res.json({
        success: true,
        data: {
          amount: result.amount,
          balanceBefore: result.balanceBefore,
          balanceAfter: result.balanceAfter
        }
      });
    } catch (error) {
      if (error.message === 'Adjustment would make balance negative') {
        return res.status(400).json({
          error: {
            type: 'validation_error',
            message: '调整后余额不能小于 0'
          }
        });
      }

      console.error('Recharge error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: error.message || 'Failed to recharge.'
        }
      });
    }
  });

  // ==================== Statistics ====================

  /**
   * GET /api/admin/stats/overview
   * Get overall statistics
   */
  router.get('/stats/overview', (req, res) => {
    try {
      const users = db.getAllUsers();
      const activeUsers = users.filter(u => u.status === 'active');
      const kiroAccounts = db.getAllKiroAccounts();

      const today = new Date().toISOString().split('T')[0];
      const todayStart = `${today}T00:00:00.000Z`;
      const todayEnd = `${today}T23:59:59.999Z`;

      const todayStats = db.db.prepare(`
        SELECT
          COUNT(*) as request_count,
          SUM(total_cost) as total_revenue,
          SUM(input_tokens) as total_input_tokens,
          SUM(output_tokens) as total_output_tokens
        FROM request_logs
        WHERE timestamp >= ? AND timestamp <= ?
      `).get(todayStart, todayEnd);

      const allTimeStats = db.db.prepare(`
        SELECT
          COUNT(*) as request_count,
          SUM(total_cost) as total_revenue,
          SUM(input_tokens) as total_input_tokens,
          SUM(output_tokens) as total_output_tokens
        FROM request_logs
      `).get();

      const totalBalance = users.reduce((sum, u) => sum + u.balance, 0);

      const accountStatusCounts = {
        active: kiroAccounts.filter(a => a.status === 'active').length,
        cooldown: kiroAccounts.filter(a => a.status === 'cooldown').length,
        error: kiroAccounts.filter(a => a.status === 'error').length,
        depleted: kiroAccounts.filter(a => a.status === 'depleted').length,
        disabled: kiroAccounts.filter(a => a.status === 'disabled').length,
        inactive: kiroAccounts.filter(a => a.status === 'inactive').length
      };

      res.json({
        success: true,
        data: {
          users: {
            total: users.length,
            active: activeUsers.length,
            suspended: users.filter(u => u.status === 'suspended').length
          },
          kiroAccounts: {
            total: kiroAccounts.length,
            active: accountStatusCounts.active,
            cooldown: accountStatusCounts.cooldown,
            error: accountStatusCounts.error,
            depleted: accountStatusCounts.depleted,
            disabled: accountStatusCounts.disabled,
            inactive: accountStatusCounts.inactive
          },
          today: {
            requests: todayStats.request_count || 0,
            revenue: todayStats.total_revenue || 0,
            inputTokens: todayStats.total_input_tokens || 0,
            outputTokens: todayStats.total_output_tokens || 0
          },
          allTime: {
            requests: allTimeStats.request_count || 0,
            revenue: allTimeStats.total_revenue || 0,
            inputTokens: allTimeStats.total_input_tokens || 0,
            outputTokens: allTimeStats.total_output_tokens || 0
          },
          totalBalance
        }
      });
    } catch (error) {
      console.error('Get overview stats error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve statistics.'
        }
      });
    }
  });

  /**
   * GET /api/admin/stats/users
   * Get user statistics ranking
   */
  router.get('/stats/users', (req, res) => {
    try {
      const { sortBy = 'cost', limit = 20 } = req.query;

      const validSortFields = {
        cost: 'total_cost',
        requests: 'total_requests',
        balance: 'balance'
      };

      const sortField = validSortFields[sortBy] || 'total_cost';

      const users = db.db.prepare(`
        SELECT
          id, username, api_key, role, balance, status,
          total_requests, total_input_tokens, total_output_tokens, total_cost,
          last_used_at
        FROM users
        ORDER BY ${sortField} DESC
        LIMIT ?
      `).all(parseInt(limit));

      res.json({
        success: true,
        data: users
      });
    } catch (error) {
      console.error('Get user stats error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve user statistics.'
        }
      });
    }
  });

  /**
   * GET /api/admin/stats/models
   * Get model statistics
   */
  router.get('/stats/models', (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      let query = `
        SELECT
          model,
          COUNT(*) as request_count,
          SUM(input_tokens) as total_input_tokens,
          SUM(output_tokens) as total_output_tokens,
          SUM(total_cost) as total_cost,
          AVG(duration_ms) as avg_duration_ms
        FROM request_logs
      `;

      const params = [];

      if (startDate || endDate) {
        const conditions = [];
        if (startDate) {
          conditions.push('timestamp >= ?');
          params.push(startDate);
        }
        if (endDate) {
          conditions.push('timestamp <= ?');
          params.push(endDate);
        }
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' GROUP BY model ORDER BY total_cost DESC';

      const stats = db.db.prepare(query).all(...params);

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Get model stats error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve model statistics.'
        }
      });
    }
  });

  /**
   * GET /api/admin/stats/accounts
   * Get Kiro account statistics
   */
  router.get('/stats/accounts', (req, res) => {
    try {
      const accounts = db.getAllKiroAccounts();

      const accountStats = accounts.map(acc => ({
        id: acc.id,
        name: acc.name,
        status: acc.status,
        request_count: acc.request_count,
        error_count: acc.error_count,
        usage_limit: acc.usage_limit,
        current_usage: acc.current_usage,
        available: acc.available,
        user_email: acc.user_email,
        subscription_type: acc.subscription_type,
        last_used_at: acc.last_used_at
      }));

      res.json({
        success: true,
        data: accountStats
      });
    } catch (error) {
      console.error('Get account stats error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve account statistics.'
        }
      });
    }
  });

  // ==================== Logs ====================

  /**
   * GET /api/admin/logs
   * Get request logs with pagination and filtering
   */
  router.get('/logs', (req, res) => {
    try {
      const {
        userId,
        model,
        success,
        startDate,
        endDate,
        limit = 100,
        offset = 0
      } = req.query;

      let query = 'SELECT * FROM request_logs WHERE 1=1';
      const params = [];

      if (userId) {
        query += ' AND user_id = ?';
        params.push(userId);
      }

      if (model) {
        query += ' AND model = ?';
        params.push(model);
      }

      if (success !== undefined) {
        query += ' AND success = ?';
        params.push(success === 'true' ? 1 : 0);
      }

      if (startDate) {
        query += ' AND timestamp >= ?';
        params.push(startDate);
      }

      if (endDate) {
        query += ' AND timestamp <= ?';
        params.push(endDate);
      }

      query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
      params.push(parseInt(limit), parseInt(offset));

      const logs = db.db.prepare(query).all(...params);

      // Get total count
      let countQuery = 'SELECT COUNT(*) as count FROM request_logs WHERE 1=1';
      const countParams = [];

      if (userId) {
        countQuery += ' AND user_id = ?';
        countParams.push(userId);
      }

      if (model) {
        countQuery += ' AND model = ?';
        countParams.push(model);
      }

      if (success !== undefined) {
        countQuery += ' AND success = ?';
        countParams.push(success === 'true' ? 1 : 0);
      }

      if (startDate) {
        countQuery += ' AND timestamp >= ?';
        countParams.push(startDate);
      }

      if (endDate) {
        countQuery += ' AND timestamp <= ?';
        countParams.push(endDate);
      }

      const totalCount = db.db.prepare(countQuery).get(...countParams).count;

      res.json({
        success: true,
        data: logs,
        pagination: {
          total: totalCount,
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      });
    } catch (error) {
      console.error('Get logs error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve logs.'
        }
      });
    }
  });

  /**
   * DELETE /api/admin/logs
   * Clear all request logs
   */
  router.delete('/logs', (req, res) => {
    try {
      const result = db.db.prepare('DELETE FROM request_logs').run();
      
      res.json({
        success: true,
        message: `已清空 ${result.changes} 条日志记录`
      });
    } catch (error) {
      console.error('Clear logs error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to clear logs.'
        }
      });
    }
  });

  // ==================== System Settings ====================

  /**
   * GET /api/admin/settings
   * Get system settings
   */
  router.get('/settings', (req, res) => {
    try {
      const settings = db.db.prepare('SELECT * FROM system_settings').all();

      const settingsObj = {};
      for (const setting of settings) {
        settingsObj[setting.key] = setting.value;
      }

      res.json({
        success: true,
        data: settingsObj
      });
    } catch (error) {
      console.error('Get settings error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve settings.'
        }
      });
    }
  });

  /**
   * PUT /api/admin/settings
   * Update system settings
   */
  router.put('/settings', (req, res) => {
    try {
      const updates = req.body;

      for (const [key, value] of Object.entries(updates)) {
        db.setSetting(key, value);
      }

      res.json({
        success: true,
        message: 'Settings updated successfully.'
      });
    } catch (error) {
      console.error('Update settings error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to update settings.'
        }
      });
    }
  });

  /**
   * PUT /api/admin/settings/admin-key
   * Update admin key (password)
   */
  router.put('/settings/admin-key', (req, res) => {
    try {
      const { newKey } = req.body;

      if (!newKey || newKey.length < 6) {
        return res.status(400).json({
          error: {
            type: 'validation_error',
            message: '新密钥长度至少为 6 个字符'
          }
        });
      }

      // Update admin key in database
      db.setSetting('admin_key', newKey);

      res.json({
        success: true,
        message: '管理密钥已更新'
      });
    } catch (error) {
      console.error('Update admin key error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to update admin key.'
        }
      });
    }
  });

  // ==================== Kiro Accounts Management ====================

  /**
   * GET /api/admin/accounts
   * Get all Kiro accounts
   */
  router.get('/accounts', (req, res) => {
    try {
      const accounts = db.getAllKiroAccounts();

      const dependencyRows = db.db.prepare(`
        SELECT kiro_account_id, COUNT(*) as count
        FROM request_logs
        GROUP BY kiro_account_id
      `).all();

      const dependencyMap = new Map(
        dependencyRows.map(row => [row.kiro_account_id, row.count])
      );

      const accountsWithDependencies = accounts.map(account => {
        const requestLogCount = dependencyMap.get(account.id) || 0;
        const machineIdSource = TokenManager.inferPersistedMachineIdSource(
          account.machine_id,
          account.refresh_token,
          accountPool?.config || {}
        );

        return {
          ...account,
          machine_id_source: machineIdSource,
          request_log_count: requestLogCount,
          has_dependencies: requestLogCount > 0
        };
      });

      res.json({
        success: true,
        data: accountsWithDependencies
      });
    } catch (error) {
      console.error('Get Kiro accounts error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve Kiro accounts.'
        }
      });
    }
  });

  /**
   * POST /api/admin/accounts/:id/refresh-usage
   * Refresh usage for a Kiro account
   */
  router.post('/accounts/:id/refresh-usage', async (req, res) => {
    try {
      const { id } = req.params;

      if (!accountPool) {
        return res.status(500).json({
          error: {
            type: 'internal_error',
            message: 'Account pool not available.'
          }
        });
      }

      const accountId = req.params.id;
      
      const usage = await accountPool.refreshAccountUsage(accountId);
      
      if (usage?.error) {
        return res.status(400).json({
          error: {
            type: 'refresh_error',
            message: usage.error
          }
        });
      }

      const account = accountPool.listAccounts().find(a => a.id === accountId);
      
      res.json({
        success: true,
        data: {
          usage,
          status: account?.status,
          message: '余额刷新成功'
        }
      });
    } catch (error) {
      console.error('Refresh usage error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: error.message || 'Failed to refresh usage.'
        }
      });
    }
  });

  /**
   * POST /api/admin/accounts/refresh-all-usage
   * Refresh usage for all Kiro accounts
   */
  router.post('/accounts/refresh-all-usage', async (req, res) => {
    try {
      if (!accountPool) {
        return res.status(500).json({
          error: {
            type: 'internal_error',
            message: 'Account pool not available.'
          }
        });
      }

      // Call the real refresh all method
      const results = await accountPool.refreshAllUsage();

      // Update database for each account
      for (const result of results) {
        if (result.usage && !result.usage.error) {
          db.updateKiroAccountUsage(result.id, result.usage);
        }
      }

      res.json({
        success: true,
        data: results
      });
    } catch (error) {
      console.error('Refresh all usage error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: error.message || 'Failed to refresh all usage.'
        }
      });
    }
  });

  /**
   * POST /api/admin/accounts/:id/enable
   * Enable a Kiro account
   */
  router.post('/accounts/:id/enable', async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if account exists in database
      const account = db.db.prepare('SELECT * FROM kiro_accounts WHERE id = ?').get(id);
      if (!account) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'Account not found in database.'
          }
        });
      }
      
      // Update database
      db.updateKiroAccountStatus(id, 'active');
      
      // Update accountPool if available
      if (accountPool) {
        const result = await accountPool.enableAccount(id);
        console.log(`AccountPool enable result for ${id}:`, result);
      }
      
      res.json({
        success: true,
        message: 'Account enabled successfully'
      });
    } catch (error) {
      console.error('Enable account error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: `Failed to enable account: ${error.message}`
        }
      });
    }
  });

  /**
   * POST /api/admin/accounts/:id/disable
   * Disable a Kiro account
   */
  router.post('/accounts/:id/disable', async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if account exists in database
      const account = db.db.prepare('SELECT * FROM kiro_accounts WHERE id = ?').get(id);
      if (!account) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'Account not found in database.'
          }
        });
      }
      
      // Update database
      db.updateKiroAccountStatus(id, 'disabled');
      
      // Update accountPool if available
      if (accountPool) {
        const result = await accountPool.disableAccount(id);
        console.log(`AccountPool disable result for ${id}:`, result);
      }
      
      res.json({
        success: true,
        message: 'Account disabled successfully'
      });
    } catch (error) {
      console.error('Disable account error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: `Failed to disable account: ${error.message}`
        }
      });
    }
  });

  /**
   * DELETE /api/admin/accounts/:id
   * Delete a Kiro account
   */
  router.delete('/accounts/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const forceDelete = req.query.force === 'true' || req.query.force === '1';
      
      const account = db.getKiroAccountById(id);
      if (!account) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'Account not found.'
          }
        });
      }
      
      const logCount = db.db.prepare(
        'SELECT COUNT(*) as count FROM request_logs WHERE kiro_account_id = ?'
      ).get(id);
      
      if (logCount && logCount.count > 0 && !forceDelete) {
        return res.status(409).json({
          error: {
            type: 'conflict',
            message: `Cannot delete account with ${logCount.count} request log(s). Consider disabling the account instead using POST /api/admin/accounts/${id}/disable`,
            dependencyCount: logCount.count,
            dependencyType: 'request_logs',
            suggestedAction: 'disable'
          }
        });
      }

      if (forceDelete) {
        const deleteWithLogs = db.db.transaction((accountId) => {
          const logsDeleteResult = db.db.prepare('DELETE FROM request_logs WHERE kiro_account_id = ?').run(accountId);
          const accountDeleteResult = db.db.prepare('DELETE FROM kiro_accounts WHERE id = ?').run(accountId);
          return {
            deletedLogs: logsDeleteResult.changes || 0,
            deletedAccounts: accountDeleteResult.changes || 0
          };
        });

        const txResult = deleteWithLogs(id);

        if (accountPool) {
          await accountPool.removeAccount(id, { skipDbDelete: true });
        }

        return res.json({
          success: true,
          message: 'Account and related request logs deleted successfully',
          data: {
            force: true,
            deletedLogs: txResult.deletedLogs,
            deletedAccounts: txResult.deletedAccounts
          }
        });
      }

      if (accountPool) {
        await accountPool.removeAccount(id, { skipDbDelete: false });
      } else {
        db.deleteKiroAccount(id);
      }
      
      res.json({
        success: true,
        message: 'Account deleted successfully'
      });
    } catch (error) {
      console.error('Delete account error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to delete account.'
        }
      });
    }
  });

  /**
   * POST /api/admin/accounts/import
   * Import accounts from JSON (supports multiple formats and templates)
   * Supports: Social, BuilderId, Enterprise templates
   */
  router.post('/accounts/import', async (req, res) => {
    try {
      const { raw_json } = req.body;
      
      if (!raw_json) {
        return res.status(400).json({
          error: {
            type: 'validation_error',
            message: 'raw_json is required'
          }
        });
      }
      
      const parsed = JSON.parse(raw_json);
      let accountsToImport = [];

      // 支持多种格式
      if (parsed.accounts && Array.isArray(parsed.accounts)) {
        // Kiro 导出格式: { accounts: [...] }
        accountsToImport = parsed.accounts;
      } else if (Array.isArray(parsed)) {
        // 数组格式: [...]
        accountsToImport = parsed;
      } else {
        // 单个账号格式: { ... }
        accountsToImport = [parsed];
      }

      const results = [];

      for (const raw of accountsToImport) {
        try {
          // 提取账号信息（支持多种格式和模板）
          let refreshToken, clientId, clientSecret, region, machineId, profileArn, email, nickname, authMethod;
          
          // Kiro 导出格式
          if (raw.credentials) {
            refreshToken = raw.credentials.refreshToken;
            clientId = raw.credentials.clientId;
            clientSecret = raw.credentials.clientSecret;
            region = raw.credentials.region || 'us-east-1';
            authMethod = raw.credentials.authMethod; // 可能已经指定了
            email = raw.email;
            nickname = raw.nickname;
            machineId = raw.machineId || null;
            
            // 从 IDP 判断模板类型
            if (raw.idp) {
              if (raw.idp === 'BuilderId') {
                authMethod = 'idc'; // BuilderId 使用 IdC
              } else if (raw.idp === 'AWS') {
                authMethod = 'idc'; // Enterprise (IAM Identity Center)
              } else {
                authMethod = 'social'; // Social login
              }
            }
            
            // 如果没有 profileArn，尝试从其他字段获取
            profileArn = raw.credentials.profileArn || null;
          } else {
            // 简单格式
            refreshToken = raw.refreshToken;
            clientId = raw.clientId;
            clientSecret = raw.clientSecret;
            region = raw.region || 'us-east-1';
            machineId = raw.machineId || null;
            profileArn = raw.profileArn || null;
            email = raw.email;
            nickname = raw.name || raw.label;
            authMethod = null;
          }

          if (!refreshToken) {
            results.push({ 
              success: false, 
              name: email || nickname || '未知账号', 
              error: 'Missing refreshToken' 
            });
            continue;
          }

          // 自动判断账号类型（如果未指定）
          if (!authMethod) {
            authMethod = (clientId && clientSecret) ? 'idc' : 'social';
          }
          
          const accountName = nickname || email || '导入的账号';

          const accountData = {
            name: accountName,
            credentials: {
              refreshToken,
              authMethod,
              clientId: clientId || null,
              clientSecret: clientSecret || null,
              region: region || 'us-east-1',
              machineId: machineId || null,
              profileArn: profileArn || null
            }
          };

          const id = await accountPool.addAccount(accountData, true); // skipValidation = true
          results.push({ 
            success: true, 
            id, 
            name: accountName,
            type: authMethod === 'idc' ? 'IdC/BuilderId/Enterprise' : 'Social'
          });
        } catch (e) {
          results.push({ 
            success: false, 
            name: raw.email || raw.nickname || raw.name || raw.label || '未知账号', 
            error: e.message 
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      res.status(201).json({
        total: accountsToImport.length,
        success: successCount,
        failed: accountsToImport.length - successCount,
        results
      });
    } catch (error) {
      console.error('Import accounts error:', error);
      res.status(400).json({
        error: {
          type: 'validation_error',
          message: `导入失败: ${error.message}`
        }
      });
    }
  });

  router.get('/agt-accounts', (req, res) => {
    try {
      const accounts = db.getAllAgtAccounts().map((account) => ({
        ...account,
        model_quotas: parseJsonSafe(account.model_quotas)
      }));
      res.json({ success: true, data: accounts });
    } catch (error) {
      console.error('Get AGT accounts error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve AGT accounts.'
        }
      });
    }
  });

  router.post('/agt-accounts/import', async (req, res) => {
    try {
      const { raw_json } = req.body;
      if (!raw_json) {
        return res.status(400).json({
          error: {
            type: 'validation_error',
            message: 'raw_json is required'
          }
        });
      }

      const parsed = JSON.parse(raw_json);
      let records = [];
      if (Array.isArray(parsed)) {
        records = parsed;
      } else if (Array.isArray(parsed.accounts)) {
        records = parsed.accounts;
      } else {
        records = [parsed];
      }

      const results = [];
      for (let i = 0; i < records.length; i++) {
        const raw = records[i];
        try {
          const normalized = normalizeImportedAgtAccount(raw, i);
          db.insertAgtAccount(normalized);
          results.push({ success: true, id: normalized.id, name: normalized.name });
        } catch (e) {
          results.push({
            success: false,
            name: raw?.email || raw?.name || `antigravity-${i + 1}`,
            error: e.message
          });
        }
      }

      const successCount = results.filter((item) => item.success).length;
      res.status(201).json({
        total: records.length,
        success: successCount,
        failed: records.length - successCount,
        results
      });
    } catch (error) {
      console.error('Import AGT accounts error:', error);
      res.status(400).json({
        error: {
          type: 'validation_error',
          message: `导入失败: ${error.message}`
        }
      });
    }
  });

  router.post('/agt-accounts/:id/enable', (req, res) => {
    try {
      const { id } = req.params;
      const account = db.getAgtAccountById(id);
      if (!account) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'AGT account not found.'
          }
        });
      }
      db.updateAgtAccountStatus(id, 'active');
      res.json({ success: true, message: 'AGT account enabled successfully' });
    } catch (error) {
      console.error('Enable AGT account error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: `Failed to enable AGT account: ${error.message}`
        }
      });
    }
  });

  router.post('/agt-accounts/:id/disable', (req, res) => {
    try {
      const { id } = req.params;
      const account = db.getAgtAccountById(id);
      if (!account) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'AGT account not found.'
          }
        });
      }
      db.updateAgtAccountStatus(id, 'disabled');
      res.json({ success: true, message: 'AGT account disabled successfully' });
    } catch (error) {
      console.error('Disable AGT account error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: `Failed to disable AGT account: ${error.message}`
        }
      });
    }
  });

  router.delete('/agt-accounts/:id', (req, res) => {
    try {
      const { id } = req.params;
      const account = db.getAgtAccountById(id);
      if (!account) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'AGT account not found.'
          }
        });
      }
      db.deleteAgtAccount(id);
      res.json({ success: true, message: 'AGT account deleted successfully' });
    } catch (error) {
      console.error('Delete AGT account error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to delete AGT account.'
        }
      });
    }
  });

  router.post('/agt-accounts/:id/refresh-models', async (req, res) => {
    try {
      const { id } = req.params;
      const account = db.getAgtAccountById(id);
      if (!account) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'AGT account not found.'
          }
        });
      }

      const modelMap = await fetchAntigravityModelsWithMeta(db, account);
      const models = Object.keys(modelMap || {});
      const quotaMeta = extractQuotaMeta(modelMap);
      db.updateAgtAccountUsageMeta(id, {
        model_quotas: quotaMeta.model_quotas,
        next_reset: quotaMeta.next_reset
      });
      db.updateAgtAccountStats(id, false);
      res.json({ success: true, data: { models, next_reset: quotaMeta.next_reset } });
    } catch (error) {
      console.error('Refresh AGT models error:', error);
      db.updateAgtAccountStats(req.params.id, true);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: error.message || 'Failed to refresh AGT models.'
        }
      });
    }
  });

  router.post('/agt-accounts/:id/refresh-usage', async (req, res) => {
    try {
      const { id } = req.params;
      const account = db.getAgtAccountById(id);
      if (!account) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'AGT account not found.'
          }
        });
      }

      const usage = await callAntigravity(db, account, '/v1internal:loadCodeAssist', {
        metadata: {
          ideType: 'ANTIGRAVITY',
          platform: 'PLATFORM_UNSPECIFIED',
          pluginType: 'GEMINI'
        }
      });

      const projectId = usage?.cloudaicompanionProject?.id || usage?.cloudaicompanionProject || account.project_id || null;
      const tierMeta = normalizeAgtTier(usage);
      
      const modelMap = await fetchAntigravityModelsWithMeta(db, account);
      const quotaMeta = extractQuotaMeta(modelMap);
      
      db.updateAgtAccountTokens(id, {
        access_token: account.access_token,
        refresh_token: account.refresh_token,
        expires_in: account.expires_in,
        expired: account.expired,
        timestamp: account.timestamp,
        project_id: projectId,
        email: account.email
      });

      db.updateAgtAccountUsageMeta(id, {
        plan_tier: tierMeta.plan_tier,
        paid_tier: tierMeta.paid_tier,
        next_reset: quotaMeta.next_reset,
        model_quotas: quotaMeta.model_quotas
      });

      db.updateAgtAccountStats(id, false);
      res.json({ success: true, data: { usage, project_id: projectId, ...tierMeta, ...quotaMeta } });
    } catch (error) {
      console.error('Refresh AGT usage error:', error);
      db.updateAgtAccountStats(req.params.id, true);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: error.message || 'Failed to refresh AGT usage.'
        }
      });
    }
  });

  // ==================== Subscription Management ====================

  /**
   * POST /api/admin/users/:id/subscription
   * Set user subscription
   */
  router.post('/users/:id/subscription', async (req, res) => {
    try {
      const { type, quota, duration } = req.body;

      if (!type || !['daily', 'monthly'].includes(type)) {
        return res.status(400).json({
          error: {
            type: 'validation_error',
            message: '订阅类型必须是 daily 或 monthly'
          }
        });
      }

      if (!quota || quota <= 0) {
        return res.status(400).json({
          error: {
            type: 'validation_error',
            message: '订阅额度必须大于 0'
          }
        });
      }

      if (!duration || duration <= 0) {
        return res.status(400).json({
          error: {
            type: 'validation_error',
            message: '订阅时长必须大于 0'
          }
        });
      }

      const result = subscription.setSubscription(req.params.id, type, quota, duration);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Set subscription error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: error.message || 'Failed to set subscription.'
        }
      });
    }
  });

  /**
   * DELETE /api/admin/users/:id/subscription
   * Cancel user subscription
   */
  router.delete('/users/:id/subscription', async (req, res) => {
    try {
      subscription.cancelSubscription(req.params.id);

      res.json({
        success: true,
        message: '订阅已取消'
      });
    } catch (error) {
      console.error('Cancel subscription error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: error.message || 'Failed to cancel subscription.'
        }
      });
    }
  });

  /**
   * POST /api/admin/users/:id/subscription/renew
   * Renew user subscription
   */
  router.post('/users/:id/subscription/renew', async (req, res) => {
    try {
      const { duration } = req.body;

      if (!duration || duration <= 0) {
        return res.status(400).json({
          error: {
            type: 'validation_error',
            message: '续费时长必须大于 0'
          }
        });
      }

      const result = subscription.renewSubscription(req.params.id, duration);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Renew subscription error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: error.message || 'Failed to renew subscription.'
        }
      });
    }
  });

  /**
   * GET /api/admin/users/:id/subscription
   * Get user subscription info
   */
  router.get('/users/:id/subscription', async (req, res) => {
    try {
      const user = db.getUserById(req.params.id);

      if (!user) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'User not found.'
          }
        });
      }

      res.json({
        success: true,
        data: {
          subscription_type: user.subscription_type,
          subscription_quota: user.subscription_quota,
          subscription_expires_at: user.subscription_expires_at,
          last_reset_at: user.last_reset_at,
          period_used: user.period_used
        }
      });
    } catch (error) {
      console.error('Get subscription error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve subscription.'
        }
      });
    }
  });

  /**
   * GET /api/admin/users/:id/subscription/history
   * Get user subscription history
   */
  router.get('/users/:id/subscription/history', async (req, res) => {
    try {
      const history = db.db.prepare(`
        SELECT * FROM subscription_history
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 50
      `).all(req.params.id);

      res.json({
        success: true,
        data: history
      });
    } catch (error) {
      console.error('Get subscription history error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve subscription history.'
        }
      });
    }
  });

  /**
   * GET /api/admin/stats/daily
   * Get daily request statistics aggregated by database
   */
  router.get('/stats/daily', (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          error: {
            type: 'validation_error',
            message: 'startDate and endDate are required'
          }
        });
      }

      // Use SQL aggregation to group by date
      const query = `
        SELECT 
          DATE(timestamp) as date,
          COUNT(*) as count
        FROM request_logs
        WHERE timestamp >= ? AND timestamp <= ?
        GROUP BY DATE(timestamp)
        ORDER BY date ASC
      `;

      const stats = db.db.prepare(query).all(startDate, endDate);

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Get daily stats error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve daily stats.'
        }
      });
    }
  });

  return router;
}
