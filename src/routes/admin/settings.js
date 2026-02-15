import express from 'express';

export function createSettingsAdminRouter(db) {
  const router = express.Router();

  /**
   * GET /api/admin/settings
   * Get all system settings
   */
  router.get('/settings', (_, res) => {
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

  return router;
}
