import express from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Admin API Routes
 * Handles all administrative operations
 */
export function createAdminRouter(db, billing, accountPool) {
  const router = express.Router();

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
      const sanitizedUsers = users.map(u => ({
        id: u.id,
        username: u.username,
        api_key: u.api_key,
        role: u.role,
        balance: u.balance,
        status: u.status,
        price_input: u.price_input,
        price_output: u.price_output,
        total_requests: u.total_requests,
        total_input_tokens: u.total_input_tokens,
        total_output_tokens: u.total_output_tokens,
        total_cost: u.total_cost,
        created_at: u.created_at,
        updated_at: u.updated_at,
        last_used_at: u.last_used_at,
        notes: u.notes
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
      const { username, api_key, role, balance, price_input, price_output, notes } = req.body;

      if (!username) {
        return res.status(400).json({
          error: {
            type: 'validation_error',
            message: 'Username is required.'
          }
        });
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
        notes: notes || null
      };

      db.createUser(userData);

      const user = db.getUserById(userId);

      res.status(201).json({
        success: true,
        data: {
          id: user.id,
          username: user.username,
          api_key: user.api_key,
          role: user.role,
          balance: user.balance,
          status: user.status,
          price_input: user.price_input,
          price_output: user.price_output,
          created_at: user.created_at
        }
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
        data: {
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
          notes: user.notes
        }
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
        data: {
          id: updatedUser.id,
          username: updatedUser.username,
          api_key: updatedUser.api_key,
          role: updatedUser.role,
          balance: updatedUser.balance,
          status: updatedUser.status,
          price_input: updatedUser.price_input,
          price_output: updatedUser.price_output,
          updated_at: updatedUser.updated_at
        }
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
   * Recharge user balance
   */
  router.post('/users/:id/recharge', (req, res) => {
    try {
      const { amount, notes } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({
          error: {
            type: 'validation_error',
            message: 'Valid amount is required.'
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
        amount,
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
      const activeKiroAccounts = kiroAccounts.filter(a => a.status === 'active');

      // Get today's stats
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

      // Get all-time stats
      const allTimeStats = db.db.prepare(`
        SELECT
          COUNT(*) as request_count,
          SUM(total_cost) as total_revenue,
          SUM(input_tokens) as total_input_tokens,
          SUM(output_tokens) as total_output_tokens
        FROM request_logs
      `).get();

      // Calculate total balance
      const totalBalance = users.reduce((sum, u) => sum + u.balance, 0);

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
            active: activeKiroAccounts.length
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

  // ==================== Kiro Accounts Management ====================

  /**
   * GET /api/admin/accounts
   * Get all Kiro accounts
   */
  router.get('/accounts', (req, res) => {
    try {
      const accounts = db.getAllKiroAccounts();
      res.json({
        success: true,
        data: accounts
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

      // Call the real refresh method from accountPool
      const usage = await accountPool.refreshAccountUsage(id);

      if (!usage) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'Account not found.'
          }
        });
      }

      if (usage.error) {
        return res.status(500).json({
          error: {
            type: 'api_error',
            message: usage.error
          }
        });
      }

      // Update database with the new usage info
      db.updateKiroAccountUsage(id, usage);

      res.json({
        success: true,
        data: usage
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
      db.updateKiroAccountStatus(id, 'active');
      res.json({
        success: true,
        message: 'Account enabled successfully'
      });
    } catch (error) {
      console.error('Enable account error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to enable account.'
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
      db.updateKiroAccountStatus(id, 'disabled');
      res.json({
        success: true,
        message: 'Account disabled successfully'
      });
    } catch (error) {
      console.error('Disable account error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to disable account.'
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
      db.deleteKiroAccount(id);
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
   * Import accounts from JSON
   */
  router.post('/accounts/import', async (req, res) => {
    try {
      const { raw_json } = req.body;
      const parsed = JSON.parse(raw_json);

      // 支持数组格式（批量导入）
      const accounts = Array.isArray(parsed) ? parsed : [parsed];
      const results = [];

      for (const raw of accounts) {
        try {
          // 判断账号类型
          const authMethod = (raw.clientId && raw.clientSecret) ? 'idc' : 'social';
          const accountName = raw.name || raw.label || raw.email || '导入的账号';

          const accountData = {
            name: accountName,
            credentials: {
              refreshToken: raw.refreshToken,
              authMethod,
              clientId: raw.clientId || null,
              clientSecret: raw.clientSecret || null,
              region: raw.region || 'us-east-1',
              machineId: raw.machineId || null,
              profileArn: raw.profileArn || null
            }
          };

          const id = await accountPool.addAccount(accountData, true); // skipValidation = true
          results.push({ success: true, id, name: accountName });
        } catch (e) {
          results.push({ success: false, name: raw.name || raw.label || raw.email, error: e.message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      res.status(201).json({
        total: accounts.length,
        success: successCount,
        failed: accounts.length - successCount,
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

  return router;
}
