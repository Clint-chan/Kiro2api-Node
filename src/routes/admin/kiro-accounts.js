import express from 'express';
import { logger } from '../../logger.js';
import { TokenManager } from '../../token.js';

export function createKiroAccountsAdminRouter(db, accountPool) {
  const router = express.Router();

  /**
   * GET /api/admin/accounts
   * List all Kiro accounts with dependency tracking
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
      logger.error('Get Kiro accounts error', { error });
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
      logger.error('Refresh usage error', { error });
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
      logger.error('Refresh all usage error', { error });
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
        logger.info('AccountPool enable result', { accountId: id, result });
      }
      
      res.json({
        success: true,
        message: 'Account enabled successfully'
      });
    } catch (error) {
      logger.error('Enable account error', { error });
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
        logger.info('AccountPool disable result', { accountId: id, result });
      }
      
      res.json({
        success: true,
        message: 'Account disabled successfully'
      });
    } catch (error) {
      logger.error('Disable account error', { error });
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
      logger.error('Delete account error', { error });
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
      logger.error('Import accounts error', { error });
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
