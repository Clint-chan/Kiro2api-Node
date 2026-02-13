import express from 'express';
import { CLIProxyClient } from '../cliproxy-client.js';

export function createCLIProxyAdminRouter() {
  const router = express.Router();
  
  const client = new CLIProxyClient(
    process.env.CLIPROXY_MANAGEMENT_URL,
    process.env.CLIPROXY_MANAGEMENT_KEY
  );

  // 账号管理
  router.get('/auth-files', async (req, res) => {
    try {
      const result = await client.listAuthFiles();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/auth-files', async (req, res) => {
    try {
      const { name } = req.query;
      const result = await client.deleteAuthFile(name);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch('/auth-files/status', async (req, res) => {
    try {
      const { name, disabled } = req.body;
      const result = await client.patchAuthFileStatus(name, disabled);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // OAuth 流程
  router.get('/antigravity-auth-url', async (req, res) => {
    try {
      const result = await client.getAntigravityAuthUrl();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/auth-status', async (req, res) => {
    try {
      const { state } = req.query;
      const result = await client.getAuthStatus(state);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 使用统计
  router.get('/usage', async (req, res) => {
    try {
      const result = await client.getUsage();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/usage/export', async (req, res) => {
    try {
      const result = await client.exportUsage();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/usage/import', async (req, res) => {
    try {
      const result = await client.importUsage(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 日志
  router.get('/logs', async (req, res) => {
    try {
      const { after } = req.query;
      const result = await client.getLogs(after);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/logs', async (req, res) => {
    try {
      const result = await client.deleteLogs();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/request-error-logs', async (req, res) => {
    try {
      const result = await client.getRequestErrorLogs();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/request-error-logs/:name', async (req, res) => {
    try {
      const { name } = req.params;
      const content = await client.downloadRequestErrorLog(name);
      res.type('text/plain').send(content);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 配置
  router.get('/config', async (req, res) => {
    try {
      const result = await client.getConfig();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/debug', async (req, res) => {
    try {
      const result = await client.getDebug();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/debug', async (req, res) => {
    try {
      const { value } = req.body;
      const result = await client.putDebug(value);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/proxy-url', async (req, res) => {
    try {
      const result = await client.getProxyUrl();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/proxy-url', async (req, res) => {
    try {
      const { value } = req.body;
      const result = await client.putProxyUrl(value);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/proxy-url', async (req, res) => {
    try {
      const result = await client.deleteProxyUrl();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/api-call', async (req, res) => {
    try {
      const { authIndex, method, url, header, data } = req.body;
      const result = await client.apiCall(authIndex, method, url, header, data);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/request-retry', async (req, res) => {
    try {
      const result = await client.getRequestRetry();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/request-retry', async (req, res) => {
    try {
      const { value } = req.body;
      const result = await client.putRequestRetry(value);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/quota-exceeded', async (req, res) => {
    try {
      const result = await client.getQuotaExceeded();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/quota-exceeded/switch-project', async (req, res) => {
    try {
      const { value } = req.body;
      const result = await client.putQuotaExceededSwitchProject(value);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.put('/quota-exceeded/switch-preview-model', async (req, res) => {
    try {
      const { value } = req.body;
      const result = await client.putQuotaExceededSwitchPreviewModel(value);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
