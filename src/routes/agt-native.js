import { Router } from 'express';
import { callAntigravity, callAntigravityStream } from '../antigravity.js';
import { isChannelAllowed } from '../user-permissions.js';
import { userAuthMiddleware } from '../middleware/auth.js';

export function createAgtNativeRouter(state) {
  const router = Router();

  router.use([
    '/v1internal:generateContent',
    '/v1internal:countTokens',
    '/v1internal:fetchAvailableModels',
    '/v1internal:streamGenerateContent'
  ], userAuthMiddleware(state.db));

  async function selectAgtAccount() {
    const accounts = state.db.getAllAgtAccounts('active');
    if (!accounts || accounts.length === 0) {
      throw new Error('No active AGT accounts available');
    }

    accounts.sort((a, b) => {
      const scoreA = (a.error_count || 0) * 5 + (a.request_count || 0);
      const scoreB = (b.error_count || 0) * 5 + (b.request_count || 0);
      return scoreA - scoreB;
    });

    return accounts[0];
  }

  async function executeNative(path, req, res) {
    if (!isChannelAllowed(req.user, 'agt')) {
      return res.status(403).json({
        error: {
          type: 'permission_error',
          message: "Channel 'agt' is not enabled for this API key."
        }
      });
    }

    const account = await selectAgtAccount();
    const response = await callAntigravity(state.db, account, path, req.body || {});
    state.db.updateAgtAccountStats(account.id, false);
    return res.json(response);
  }

  router.post('/v1internal:generateContent', async (req, res) => {
    try {
      return await executeNative('/v1internal:generateContent', req, res);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'AGT generateContent failed' });
    }
  });

  router.post('/v1internal:countTokens', async (req, res) => {
    try {
      return await executeNative('/v1internal:countTokens', req, res);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'AGT countTokens failed' });
    }
  });

  router.post('/v1internal:fetchAvailableModels', async (req, res) => {
    try {
      return await executeNative('/v1internal:fetchAvailableModels', req, res);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'AGT fetchAvailableModels failed' });
    }
  });

  router.post('/v1internal:streamGenerateContent', async (req, res) => {
    let selectedAccount = null;
    try {
      if (!isChannelAllowed(req.user, 'agt')) {
        return res.status(403).json({
          error: {
            type: 'permission_error',
            message: "Channel 'agt' is not enabled for this API key."
          }
        });
      }

      selectedAccount = await selectAgtAccount();
      const upstream = await callAntigravityStream(state.db, selectedAccount, '/v1internal:streamGenerateContent', req.body || {});

      res.status(200);
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      if (!upstream.body) {
        state.db.updateAgtAccountStats(selectedAccount.id, true);
        return res.status(502).json({ error: 'AGT stream body unavailable' });
      }

      for await (const chunk of upstream.body) {
        res.write(chunk);
      }

      state.db.updateAgtAccountStats(selectedAccount.id, false);
      return res.end();
    } catch (error) {
      if (selectedAccount?.id) {
        state.db.updateAgtAccountStats(selectedAccount.id, true);
      }
      return res.status(500).json({ error: error.message || 'AGT streamGenerateContent failed' });
    }
  });

  return router;
}
