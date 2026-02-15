import express from 'express';
import { logger } from '../../logger.js';
import {
  callAntigravity,
  fetchAntigravityModelsWithMeta,
  normalizeImportedAntigravityAccount
} from '../../antigravity.js';
import { parseJsonSafe, normalizeAntigravityTier, extractQuotaMeta } from './helpers.js';

export function createAntigravityAdminRouter(db) {
  const router = express.Router();

  // GET / - List all Antigravity accounts
  router.get('/', (req, res) => {
    try {
      const accounts = db.getAllAntigravityAccounts().map((account) => ({
        ...account,
        model_quotas: parseJsonSafe(account.model_quotas)
      }));
      res.json({ success: true, data: accounts });
    } catch (error) {
      logger.error('Get Antigravity accounts error', { error });
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to retrieve Antigravity accounts.'
        }
      });
    }
  });

  // POST /import - Import Antigravity accounts
  router.post('/import', async (req, res) => {
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
          const normalized = normalizeImportedAntigravityAccount(raw, i);
          db.insertAntigravityAccount(normalized);
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
      logger.error('Import Antigravity accounts error', { error });
      res.status(400).json({
        error: {
          type: 'validation_error',
          message: `导入失败: ${error.message}`
        }
      });
    }
  });

  // POST /:id/enable - Enable Antigravity account
  router.post('/:id/enable', (req, res) => {
    try {
      const { id } = req.params;
      const account = db.getAntigravityAccountById(id);
      if (!account) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'Antigravity account not found.'
          }
        });
      }
      db.updateAntigravityAccountStatus(id, 'active');
      res.json({ success: true, message: 'Antigravity account enabled successfully' });
    } catch (error) {
      logger.error('Enable Antigravity account error', { error });
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: `Failed to enable Antigravity account: ${error.message}`
        }
      });
    }
  });

  // POST /:id/disable - Disable Antigravity account
  router.post('/:id/disable', (req, res) => {
    try {
      const { id } = req.params;
      const account = db.getAntigravityAccountById(id);
      if (!account) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'Antigravity account not found.'
          }
        });
      }
      db.updateAntigravityAccountStatus(id, 'disabled');
      res.json({ success: true, message: 'Antigravity account disabled successfully' });
    } catch (error) {
      logger.error('Disable Antigravity account error', { error });
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: `Failed to disable Antigravity account: ${error.message}`
        }
      });
    }
  });

  // DELETE /:id - Delete Antigravity account
  router.delete('/:id', (req, res) => {
    try {
      const { id } = req.params;
      const account = db.getAntigravityAccountById(id);
      if (!account) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'Antigravity account not found.'
          }
        });
      }
      db.deleteAntigravityAccount(id);
      res.json({ success: true, message: 'Antigravity account deleted successfully' });
    } catch (error) {
      logger.error('Delete Antigravity account error', { error });
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'Failed to delete Antigravity account.'
        }
      });
    }
  });

  // POST /:id/refresh-models - Refresh available models and quotas
  router.post('/:id/refresh-models', async (req, res) => {
    try {
      const { id } = req.params;
      const account = db.getAntigravityAccountById(id);
      if (!account) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'Antigravity account not found.'
          }
        });
      }

      const modelMap = await fetchAntigravityModelsWithMeta(db, account);
      const models = Object.keys(modelMap || {});
      const quotaMeta = extractQuotaMeta(modelMap);
      db.updateAntigravityAccountUsageMeta(id, {
        model_quotas: quotaMeta.model_quotas,
        next_reset: quotaMeta.next_reset
      });
      db.updateAntigravityAccountStats(id, false);
      res.json({ success: true, data: { models, next_reset: quotaMeta.next_reset } });
    } catch (error) {
      logger.error('Refresh Antigravity models error', { error });
      db.updateAntigravityAccountStats(req.params.id, true);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: error.message || 'Failed to refresh Antigravity models.'
        }
      });
    }
  });

  // POST /:id/refresh-usage - Refresh usage, tier and quotas
  router.post('/:id/refresh-usage', async (req, res) => {
    try {
      const { id } = req.params;
      const account = db.getAntigravityAccountById(id);
      if (!account) {
        return res.status(404).json({
          error: {
            type: 'not_found',
            message: 'Antigravity account not found.'
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
      const tierMeta = normalizeAntigravityTier(usage);
      
      const modelMap = await fetchAntigravityModelsWithMeta(db, account);
      const quotaMeta = extractQuotaMeta(modelMap);
      
      db.updateAntigravityAccountTokens(id, {
        access_token: account.access_token,
        refresh_token: account.refresh_token,
        expires_in: account.expires_in,
        expired: account.expired,
        timestamp: account.timestamp,
        project_id: projectId,
        email: account.email
      });

      db.updateAntigravityAccountUsageMeta(id, {
        plan_tier: tierMeta.plan_tier,
        paid_tier: tierMeta.paid_tier,
        next_reset: quotaMeta.next_reset,
        model_quotas: quotaMeta.model_quotas
      });

      db.updateAntigravityAccountStats(id, false);
      res.json({ success: true, data: { usage, project_id: projectId, ...tierMeta, ...quotaMeta } });
    } catch (error) {
      logger.error('Refresh Antigravity usage error', { error });
      db.updateAntigravityAccountStats(req.params.id, true);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: error.message || 'Failed to refresh Antigravity usage.'
        }
      });
    }
  });

  return router;
}
