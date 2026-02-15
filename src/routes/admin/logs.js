import express from 'express';
import { logger } from '../../logger.js';

export function createLogsAdminRouter(db) {
  const router = express.Router();

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
      logger.error('Get logs error', { error });
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
  router.delete('/logs', (_req, res) => {
    try {
      const result = db.db.prepare('DELETE FROM request_logs').run();
      
      res.json({
        success: true,
        message: `已清空 ${result.changes} 条日志记录`
      });
    } catch (error) {
      logger.error('Clear logs error', { error });
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to clear logs.'
        }
      });
    }
  });

  return router;
}
