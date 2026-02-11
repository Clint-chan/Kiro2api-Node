import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { TokenManager } from './token.js';
import { checkUsageLimits } from './usage.js';

const ACCOUNTS_FILE = 'accounts.json';
const LOGS_FILE = 'request_logs.json';

export class AccountPool {
  constructor(config, db = null) {
    this.config = config;
    this.db = db;
    this.accounts = new Map();
    this.tokenManagers = new Map();
    this.strategy = 'round-robin';
    this.roundRobinIndex = 0;
    this.logs = [];
    this.maxLogs = 1000;
  }

  async load() {
    try {
      await fs.mkdir(this.config.dataDir, { recursive: true });

      // 从数据库加载账号
      if (this.db) {
        try {
          const accounts = this.db.getAllKiroAccounts();
          for (const acc of accounts) {
            // 验证必需字段
            if (!acc.refresh_token) {
              console.log(`⚠ 跳过账号 ${acc.name}: refresh_token 为空`);
              continue;
            }

            // 转换数据库格式到内存格式
            const account = {
              id: acc.id,
              name: acc.name,
              credentials: {
                refreshToken: acc.refresh_token,
                authMethod: acc.auth_method,
                clientId: acc.client_id || null,
                clientSecret: acc.client_secret || null,
                region: acc.region || null,
                machineId: acc.machine_id || null,
                profileArn: acc.profile_arn || null
              },
              status: acc.status,
              requestCount: acc.request_count || 0,
              errorCount: acc.error_count || 0,
              createdAt: acc.created_at,
              lastUsedAt: acc.last_used_at,
              usage: acc.usage_limit ? {
                usageLimit: acc.usage_limit,
                currentUsage: acc.current_usage,
                available: acc.available,
                userEmail: acc.user_email,
                subscriptionType: acc.subscription_type,
                nextReset: acc.next_reset,
                updatedAt: acc.usage_updated_at
              } : null
            };

            this.accounts.set(account.id, account);

            try {
              this.tokenManagers.set(account.id, new TokenManager(this.config, account.credentials));
            } catch (e) {
              console.log(`⚠ 无法为账号 ${acc.name} 创建 TokenManager: ${e.message}`);
            }
          }
          console.log(`✓ 加载了 ${accounts.length} 个账号`);
        } catch (e) {
          console.error('从数据库加载账号失败:', e);
        }
      } else {
        // 兼容旧的 JSON 文件方式
        const accountsPath = path.join(this.config.dataDir, ACCOUNTS_FILE);
        try {
          const content = await fs.readFile(accountsPath, 'utf-8');
          const accounts = JSON.parse(content);
          for (const acc of accounts) {
            this.accounts.set(acc.id, acc);
            this.tokenManagers.set(acc.id, new TokenManager(this.config, acc.credentials));
          }
          console.log(`✓ 加载了 ${accounts.length} 个账号`);
        } catch { }
      }

      // 加载日志（暂时保留，未来可以从数据库读取）
      const logsPath = path.join(this.config.dataDir, LOGS_FILE);
      try {
        const content = await fs.readFile(logsPath, 'utf-8');
        this.logs = JSON.parse(content).slice(-this.maxLogs);
      } catch { }
    } catch (e) {
      console.error('加载账号池失败:', e);
    }
  }

  async save() {
    const accountsPath = path.join(this.config.dataDir, ACCOUNTS_FILE);
    const accounts = Array.from(this.accounts.values());
    await fs.writeFile(accountsPath, JSON.stringify(accounts, null, 2));
  }

  async saveLogs() {
    const logsPath = path.join(this.config.dataDir, LOGS_FILE);
    await fs.writeFile(logsPath, JSON.stringify(this.logs.slice(-this.maxLogs)));
  }

  async addAccount(account, skipValidation = false) {
    const id = account.id || uuidv4();
    const newAccount = {
      id,
      name: account.name || '未命名账号',
      credentials: account.credentials,
      status: 'active',
      requestCount: 0,
      errorCount: 0,
      createdAt: new Date().toISOString(),
      lastUsedAt: null
    };

    // 验证凭证（可跳过）
    if (!skipValidation) {
      const tm = new TokenManager(this.config, newAccount.credentials);
      await tm.ensureValidToken(); // 会抛出错误如果无效
    }

    this.accounts.set(id, newAccount);
    this.tokenManagers.set(id, new TokenManager(this.config, newAccount.credentials));
    await this.save();
    
    // 同步到数据库
    if (this.db) {
      this.db.insertKiroAccount(newAccount);
      console.log(`✓ 账号 ${newAccount.name} (${id}) 已添加到数据库`);
    }
    
    return id;
  }

  async removeAccount(id) {
    const removed = this.accounts.delete(id);
    this.tokenManagers.delete(id);
    if (removed) {
      await this.save();
      
      // 同步到数据库
      if (this.db) {
        this.db.deleteKiroAccount(id);
        console.log(`✓ 账号 ${id} 已从数据库删除`);
      }
    }
    return removed;
  }

  listAccounts() {
    return Array.from(this.accounts.values()).map(a => ({
      id: a.id,
      name: a.name,
      status: a.status,
      requestCount: a.requestCount,
      errorCount: a.errorCount,
      createdAt: a.createdAt,
      lastUsedAt: a.lastUsedAt,
      usage: a.usage || null
    }));
  }

  async refreshAccountUsage(id) {
    const account = this.accounts.get(id);
    if (!account) return null;

    try {
      const tm = this.tokenManagers.get(id);

      // 先刷新token获取新的access_token
      const token = await tm.ensureValidToken();

      // 如果refreshToken被更新了，同步到account和数据库
      if (tm.credentials.refreshToken !== account.credentials.refreshToken) {
        account.credentials.refreshToken = tm.credentials.refreshToken;
        if (this.db) {
          this.db.db.prepare('UPDATE kiro_accounts SET refresh_token = ? WHERE id = ?')
            .run(tm.credentials.refreshToken, id);
        }
      }

      // 用新的access_token获取usage
      const usage = await checkUsageLimits(token, this.config);

      account.usage = {
        usageLimit: usage.usageLimit,
        currentUsage: usage.currentUsage,
        available: usage.available,
        userEmail: usage.userEmail,
        subscriptionType: usage.subscriptionType,
        nextReset: usage.nextReset,
        updatedAt: new Date().toISOString()
      };

      // 如果刷新成功，确保状态为 active
      if (account.status === 'error') {
        account.status = 'active';
      }

      await this.save();

      // 同步到数据库
      if (this.db) {
        this.db.updateKiroAccountUsage(id, account.usage);
        this.db.updateKiroAccountStatus(id, account.status);
      }

      return account.usage;
    } catch (e) {
      console.error(`刷新账号 ${id} 额度失败:`, e.message);

      // 检查是否被封禁
      if (e.message.startsWith('BANNED:')) {
        account.status = 'error';
        await this.save();
        if (this.db) {
          this.db.updateKiroAccountStatus(id, 'error');
        }
        return { error: '账号已被封禁: ' + e.message.substring(7) };
      }

      // 检查是否 token 无效
      if (e.message.startsWith('TOKEN_INVALID:')) {
        account.status = 'error';
        await this.save();
        if (this.db) {
          this.db.updateKiroAccountStatus(id, 'error');
        }
        return { error: 'Token已失效: ' + e.message.substring(14) };
      }

      // 检查其他token过期情况
      if (e.message.includes('401') || e.message.includes('403') ||
          e.message.includes('过期') || e.message.includes('无效') ||
          e.message.includes('刷新失败')) {
        account.status = 'error';
        await this.save();
        if (this.db) {
          this.db.updateKiroAccountStatus(id, 'error');
        }
        return { error: 'Token已过期或无效' };
      }

      return { error: e.message };
    }
  }

  async refreshAllUsage() {
    const accounts = Array.from(this.accounts.entries())
      .filter(([id, account]) => account.status !== 'error');

    const results = [];

    // 并发刷新，每次最多 10 个，使用 Promise.allSettled 避免单个失败影响整体
    const batchSize = 10;
    for (let i = 0; i < accounts.length; i += batchSize) {
      const batch = accounts.slice(i, i + batchSize);
      const batchPromises = batch.map(async ([id, account]) => {
        try {
          const usage = await this.refreshAccountUsage(id);
          return { id, name: account.name, usage, success: !usage?.error };
        } catch (error) {
          return { id, name: account.name, usage: { error: error.message }, success: false };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason }));
    }

    return results;
  }

  async selectAccount() {
    const available = Array.from(this.accounts.values())
      .filter(a => a.status === 'active');

    if (available.length === 0) return null;

    let selected;
    switch (this.strategy) {
      case 'random':
        selected = available[Math.floor(Math.random() * available.length)];
        break;
      case 'least-used':
        selected = available.reduce((a, b) => a.requestCount < b.requestCount ? a : b);
        break;
      default: // round-robin
        selected = available[this.roundRobinIndex % available.length];
        this.roundRobinIndex++;
    }

    selected.requestCount++;
    selected.lastUsedAt = new Date().toISOString();

    // 异步保存，不阻塞请求
    this.save().catch(() => {});

    return {
      id: selected.id,
      name: selected.name,
      tokenManager: this.tokenManagers.get(selected.id)
    };
  }

  async recordError(id, isRateLimit) {
    const account = this.accounts.get(id);
    if (!account) return;
    
    account.errorCount++;
    if (isRateLimit) {
      account.status = 'cooldown';
      setTimeout(() => {
        if (account.status === 'cooldown') {
          account.status = 'active';
          // 同步到数据库
          if (this.db) {
            this.db.updateKiroAccountStatus(id, 'active');
          }
        }
      }, 5 * 60 * 1000); // 5分钟冷却
      
      // 同步到数据库
      if (this.db) {
        this.db.updateKiroAccountStatus(id, 'cooldown');
      }
    }
    await this.save();
  }

  async markInvalid(id) {
    const account = this.accounts.get(id);
    if (!account) {
      console.error(`❌ 账号 ${id} 不存在于 accountPool 中`);
      // 即使内存中没有，也尝试更新数据库
      if (this.db) {
        this.db.updateKiroAccountStatus(id, 'error');
        console.log(`✓ 已在数据库中标记账号 ${id} 为 error`);
        return true;
      }
      return false;
    }
    
    account.status = 'error';
    await this.save();
    
    // 同步到数据库
    if (this.db) {
      this.db.updateKiroAccountStatus(id, 'error');
    }
    console.log(`✓ 已标记账号 ${account.name} (${id}) 为 error`);
  }

  async enableAccount(id) {
    const account = this.accounts.get(id);
    if (!account) {
      console.error(`❌ 账号 ${id} 不存在于 accountPool 中`);
      // 即使内存中没有，也尝试更新数据库
      if (this.db) {
        this.db.updateKiroAccountStatus(id, 'active');
        console.log(`✓ 已在数据库中启用账号 ${id}`);
        return true;
      }
      return false;
    }
    
    account.status = 'active';
    await this.save();
    
    // 同步到数据库
    if (this.db) {
      this.db.updateKiroAccountStatus(id, 'active');
    }
    console.log(`✓ 已启用账号 ${account.name} (${id})`);
    return true;
  }

  async disableAccount(id) {
    const account = this.accounts.get(id);
    if (!account) {
      console.error(`❌ 账号 ${id} 不存在于 accountPool 中`);
      // 即使内存中没有，也尝试更新数据库
      if (this.db) {
        this.db.updateKiroAccountStatus(id, 'disabled');
        console.log(`✓ 已在数据库中禁用账号 ${id}`);
        return true;
      }
      return false;
    }
    
    account.status = 'disabled';
    await this.save();
    
    // 同步到数据库
    if (this.db) {
      this.db.updateKiroAccountStatus(id, 'disabled');
    }
    console.log(`✓ 已禁用账号 ${account.name} (${id})`);
    return true;
  }

  setStrategy(strategy) {
    this.strategy = strategy;
  }

  getStrategy() {
    return this.strategy;
  }

  getStats() {
    const accounts = Array.from(this.accounts.values());
    return {
      total: accounts.length,
      active: accounts.filter(a => a.status === 'active').length,
      cooldown: accounts.filter(a => a.status === 'cooldown').length,
      error: accounts.filter(a => a.status === 'error').length,
      inactive: accounts.filter(a => a.status === 'inactive').length,
      disabled: accounts.filter(a => a.status === 'disabled').length,
      totalRequests: accounts.reduce((sum, a) => sum + a.requestCount, 0),
      totalErrors: accounts.reduce((sum, a) => sum + a.errorCount, 0)
    };
  }

  addLog(log) {
    this.logs.push({ ...log, timestamp: new Date().toISOString() });
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
    this.saveLogs().catch(() => {});
  }

  getRecentLogs(n = 100) {
    return this.logs.slice(-n).reverse();
  }

  async clearLogs() {
    this.logs = [];
    await this.saveLogs();
  }

  async removeAccounts(ids) {
    let removed = 0;
    for (const id of ids) {
      if (this.accounts.delete(id)) {
        this.tokenManagers.delete(id);
        removed++;
      }
    }
    if (removed > 0) await this.save();
    return { total: ids.length, removed };
  }

  getLogStats() {
    return {
      totalInputTokens: this.logs.reduce((sum, l) => sum + (l.inputTokens || 0), 0),
      totalOutputTokens: this.logs.reduce((sum, l) => sum + (l.outputTokens || 0), 0)
    };
  }
}
