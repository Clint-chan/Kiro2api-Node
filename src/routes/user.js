import express from 'express';

/**
 * User API Routes
 * Handles user-facing operations
 */
export function createUserRouter(db, billing, subscription) {
  const router = express.Router();

  // ==================== User Profile ====================

  /**
   * GET /api/user/profile
   * Get user profile information
   */
  router.get('/profile', (req, res) => {
    try {
      const user = req.user;

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
          last_used_at: user.last_used_at
        }
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve profile.'
        }
      });
    }
  });

  /**
   * GET /api/user/balance
   * Get user balance information
   */
  router.get('/balance', (req, res) => {
    try {
      const balanceInfo = billing.getUserBalanceInfo(req.user.id);

      res.json({
        success: true,
        data: balanceInfo
      });
    } catch (error) {
      console.error('Get balance error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve balance.'
        }
      });
    }
  });

  // ==================== Usage Statistics ====================

  /**
   * GET /api/user/stats
   * Get user usage statistics
   */
  router.get('/stats', (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      const stats = db.getUserStats(req.user.id, startDate, endDate);

      res.json({
        success: true,
        data: {
          totalRequests: stats.total_requests || 0,
          successfulRequests: stats.successful_requests || 0,
          failedRequests: stats.failed_requests || 0,
          totalInputTokens: stats.total_input_tokens || 0,
          totalOutputTokens: stats.total_output_tokens || 0,
          totalCost: stats.total_cost || 0,
          period: {
            start: startDate || null,
            end: endDate || null
          }
        }
      });
    } catch (error) {
      console.error('Get stats error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve statistics.'
        }
      });
    }
  });

  /**
   * GET /api/user/stats/models
   * Get statistics by model
   */
  router.get('/stats/models', (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      const modelStats = db.getModelStats(req.user.id, startDate, endDate);

      res.json({
        success: true,
        data: modelStats
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
   * GET /api/user/stats/daily
   * Get daily statistics
   */
  router.get('/stats/daily', (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          error: {
            type: 'validation_error',
            message: 'startDate and endDate are required.'
          }
        });
      }

      const dailyStats = db.getDailyStats(req.user.id, startDate, endDate);

      res.json({
        success: true,
        data: dailyStats
      });
    } catch (error) {
      console.error('Get daily stats error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve daily statistics.'
        }
      });
    }
  });

  // ==================== Request Logs ====================

  /**
   * GET /api/user/logs
   * Get user request logs
   */
  router.get('/logs', (req, res) => {
    try {
      const { limit = 100, offset = 0 } = req.query;

      const logs = db.getUserLogs(
        req.user.id,
        parseInt(limit),
        parseInt(offset)
      );

      // Get total count
      const totalCount = db.db.prepare(`
        SELECT COUNT(*) as count FROM request_logs WHERE user_id = ?
      `).get(req.user.id).count;

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

  // ==================== Recharge Records ====================

  /**
   * GET /api/user/recharges
   * Get user recharge records
   */
  router.get('/recharges', (req, res) => {
    try {
      const { limit = 50, offset = 0 } = req.query;

      const recharges = db.getRechargeRecords(
        req.user.id,
        parseInt(limit),
        parseInt(offset)
      );

      // Get total count
      const totalCount = db.db.prepare(`
        SELECT COUNT(*) as count FROM recharge_records WHERE user_id = ?
      `).get(req.user.id).count;

      res.json({
        success: true,
        data: recharges,
        pagination: {
          total: totalCount,
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      });
    } catch (error) {
      console.error('Get recharges error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve recharge records.'
        }
      });
    }
  });

  // ==================== Bill Generation ====================

  /**
   * GET /api/user/bill
   * Generate bill for specified period
   */
  router.get('/bill', (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          error: {
            type: 'validation_error',
            message: 'startDate and endDate are required.'
          }
        });
      }

      const bill = billing.generateBill(req.user.id, startDate, endDate);

      res.json({
        success: true,
        data: bill
      });
    } catch (error) {
      console.error('Generate bill error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: error.message || 'Failed to generate bill.'
        }
      });
    }
  });

  // ==================== Cost Estimation ====================

  /**
   * POST /api/user/estimate
   * Estimate cost for a request
   */
  router.post('/estimate', (req, res) => {
    try {
      const { inputTokens, outputTokens } = req.body;

      if (!inputTokens || !outputTokens) {
        return res.status(400).json({
          error: {
            type: 'validation_error',
            message: 'inputTokens and outputTokens are required.'
          }
        });
      }

      const cost = billing.estimateCost(
        parseInt(inputTokens),
        parseInt(outputTokens),
        req.user
      );

      res.json({
        success: true,
        data: {
          inputTokens: parseInt(inputTokens),
          outputTokens: parseInt(outputTokens),
          inputCost: cost.inputCost,
          outputCost: cost.outputCost,
          totalCost: cost.totalCost,
          priceConfig: {
            inputPrice: req.user.price_input,
            outputPrice: req.user.price_output
          }
        }
      });
    } catch (error) {
      console.error('Estimate cost error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to estimate cost.'
        }
      });
    }
  });

  // ==================== Subscription Info ====================

  /**
   * GET /api/user/subscription
   * Get user subscription info
   */
  router.get('/subscription', (req, res) => {
    try {
      const user = req.user;

      res.json({
        success: true,
        data: {
          subscription_type: user.subscription_type,
          subscription_quota: user.subscription_quota,
          subscription_expires_at: user.subscription_expires_at,
          last_reset_at: user.last_reset_at,
          period_used: user.period_used,
          next_reset: subscription.getNextResetTime(user)
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
   * GET /api/user/subscription/reset-logs
   * Get user quota reset logs
   */
  router.get('/subscription/reset-logs', (req, res) => {
    try {
      const { limit = 50, offset = 0 } = req.query;

      const logs = db.db.prepare(`
        SELECT * FROM quota_reset_logs
        WHERE user_id = ?
        ORDER BY reset_at DESC
        LIMIT ? OFFSET ?
      `).all(req.user.id, parseInt(limit), parseInt(offset));

      const totalCount = db.db.prepare(`
        SELECT COUNT(*) as count FROM quota_reset_logs WHERE user_id = ?
      `).get(req.user.id).count;

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
      console.error('Get reset logs error:', error);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve reset logs.'
        }
      });
    }
  });

  return router;
}
