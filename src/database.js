import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

/**
 * DatabaseManager - Handles all database operations
 * Uses better-sqlite3 for synchronous, high-performance SQLite access
 */
export class DatabaseManager {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.statements = {};
  }

  /**
   * Initialize database connection and prepare statements
   */
  init() {
    try {
      // Ensure data directory exists
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Open database connection
      this.db = new Database(this.dbPath);

      // Enable WAL mode for better concurrency
      this.db.pragma('journal_mode = WAL');

      // Enable foreign keys
      this.db.pragma('foreign_keys = ON');

      // Prepare commonly used statements
      this.prepareStatements();

      console.log('✓ Database initialized successfully');
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * Prepare frequently used SQL statements
   */
  prepareStatements() {
    // User queries
    this.statements.getUserByApiKey = this.db.prepare(
      'SELECT * FROM users WHERE api_key = ? AND status = ?'
    );

    this.statements.getUserById = this.db.prepare(
      'SELECT * FROM users WHERE id = ?'
    );

    this.statements.updateUserBalance = this.db.prepare(
      'UPDATE users SET balance = ?, updated_at = ? WHERE id = ?'
    );

    this.statements.updateUserStats = this.db.prepare(`
      UPDATE users SET
        total_requests = total_requests + 1,
        total_input_tokens = total_input_tokens + ?,
        total_output_tokens = total_output_tokens + ?,
        total_cost = total_cost + ?,
        last_used_at = ?,
        updated_at = ?
      WHERE id = ?
    `);

    this.statements.insertUser = this.db.prepare(`
      INSERT INTO users (
        id, username, api_key, role, balance, status,
        price_input, price_output,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Request log queries
    this.statements.insertRequestLog = this.db.prepare(`
      INSERT INTO request_logs (
        user_id, user_api_key, kiro_account_id, kiro_account_name,
        model, input_tokens, output_tokens, duration_ms,
        input_cost, output_cost, total_cost,
        success, error_message, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Kiro account queries
    this.statements.getKiroAccountById = this.db.prepare(
      'SELECT * FROM kiro_accounts WHERE id = ?'
    );

    this.statements.updateKiroAccountStats = this.db.prepare(`
      UPDATE kiro_accounts SET
        request_count = request_count + 1,
        last_used_at = ?
      WHERE id = ?
    `);

    this.statements.updateKiroAccountError = this.db.prepare(`
      UPDATE kiro_accounts SET
        error_count = error_count + 1,
        last_used_at = ?
      WHERE id = ?
    `);

    // System settings queries
    this.statements.getSetting = this.db.prepare(
      'SELECT value FROM system_settings WHERE key = ?'
    );

    this.statements.setSetting = this.db.prepare(`
      INSERT OR REPLACE INTO system_settings (key, value, updated_at)
      VALUES (?, ?, ?)
    `);
  }

  /**
   * Get user by API key
   */
  getUserByApiKey(apiKey, status = 'active') {
    return this.statements.getUserByApiKey.get(apiKey, status);
  }

  /**
   * Get user by ID
   */
  getUserById(id) {
    return this.statements.getUserById.get(id);
  }

  /**
   * Create new user
   */
  createUser(userData) {
    const now = new Date().toISOString();
    return this.statements.insertUser.run(
      userData.id,
      userData.username,
      userData.api_key,
      userData.role || 'user',
      userData.balance || 0.0,
      userData.status || 'active',
      userData.price_input || 3.0,
      userData.price_output || 15.0,
      now,
      now
    );
  }

  /**
   * Update user balance
   */
  updateUserBalance(userId, newBalance) {
    const now = new Date().toISOString();
    return this.statements.updateUserBalance.run(newBalance, now, userId);
  }

  /**
   * Update user statistics after request
   */
  updateUserStats(userId, inputTokens, outputTokens, cost) {
    const now = new Date().toISOString();
    return this.statements.updateUserStats.run(
      inputTokens,
      outputTokens,
      cost,
      now,
      now,
      userId
    );
  }

  /**
   * Insert request log
   */
  insertRequestLog(logData) {
    return this.statements.insertRequestLog.run(
      logData.user_id,
      logData.user_api_key,
      logData.kiro_account_id,
      logData.kiro_account_name,
      logData.model,
      logData.input_tokens,
      logData.output_tokens,
      logData.duration_ms,
      logData.input_cost,
      logData.output_cost,
      logData.total_cost,
      logData.success ? 1 : 0,
      logData.error_message || null,
      logData.timestamp
    );
  }

  /**
   * Get user statistics
   */
  getUserStats(userId, startDate = null, endDate = null) {
    let query = `
      SELECT
        COUNT(*) as total_requests,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(total_cost) as total_cost,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_requests,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_requests
      FROM request_logs
      WHERE user_id = ?
    `;

    const params = [userId];

    if (startDate) {
      query += ' AND timestamp >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND timestamp <= ?';
      params.push(endDate);
    }

    return this.db.prepare(query).get(...params);
  }

  /**
   * Get model statistics for user
   */
  getModelStats(userId, startDate = null, endDate = null) {
    let query = `
      SELECT
        model,
        COUNT(*) as request_count,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(total_cost) as total_cost
      FROM request_logs
      WHERE user_id = ?
    `;

    const params = [userId];

    if (startDate) {
      query += ' AND timestamp >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND timestamp <= ?';
      params.push(endDate);
    }

    query += ' GROUP BY model ORDER BY total_cost DESC';

    return this.db.prepare(query).all(...params);
  }

  /**
   * Get daily statistics for user
   */
  getDailyStats(userId, startDate, endDate) {
    const query = `
      SELECT
        DATE(timestamp) as date,
        COUNT(*) as request_count,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(total_cost) as total_cost
      FROM request_logs
      WHERE user_id = ? AND timestamp >= ? AND timestamp <= ?
      GROUP BY DATE(timestamp)
      ORDER BY date ASC
    `;

    return this.db.prepare(query).all(userId, startDate, endDate);
  }

  /**
   * Get request logs for user
   */
  getUserLogs(userId, limit = 100, offset = 0) {
    const query = `
      SELECT * FROM request_logs
      WHERE user_id = ?
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `;

    return this.db.prepare(query).all(userId, limit, offset);
  }

  /**
   * Get all users (admin)
   */
  getAllUsers(status = null) {
    let query = 'SELECT * FROM users';
    const params = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    return this.db.prepare(query).all(...params);
  }

  /**
   * Update user
   */
  updateUser(userId, updates) {
    const allowedFields = [
      'username', 'balance', 'status', 'role',
      'price_input', 'price_output', 'notes'
    ];

    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (fields.length === 0) {
      return { changes: 0 };
    }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(userId);

    const query = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    return this.db.prepare(query).run(...values);
  }

  /**
   * Delete user
   */
  deleteUser(userId) {
    return this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }

  /**
   * Insert recharge record
   */
  insertRechargeRecord(data) {
    const query = `
      INSERT INTO recharge_records (
        user_id, amount, balance_before, balance_after,
        operator_id, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    return this.db.prepare(query).run(
      data.user_id,
      data.amount,
      data.balance_before,
      data.balance_after,
      data.operator_id || null,
      data.notes || null,
      new Date().toISOString()
    );
  }

  /**
   * Get recharge records for user
   */
  getRechargeRecords(userId, limit = 50, offset = 0) {
    const query = `
      SELECT * FROM recharge_records
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    return this.db.prepare(query).all(userId, limit, offset);
  }

  /**
   * Get Kiro account by ID
   */
  getKiroAccountById(id) {
    return this.statements.getKiroAccountById.get(id);
  }

  /**
   * Get all Kiro accounts
   */
  getAllKiroAccounts(status = null) {
    let query = 'SELECT * FROM kiro_accounts';
    const params = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    return this.db.prepare(query).all(...params);
  }

  /**
   * Insert Kiro account
   */
  insertKiroAccount(accountData) {
    const query = `
      INSERT INTO kiro_accounts (
        id, name, refresh_token, auth_method,
        client_id, client_secret, region, machine_id, profile_arn,
        status, request_count, error_count,
        usage_limit, current_usage, available,
        user_email, subscription_type, next_reset, usage_updated_at,
        created_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const now = new Date().toISOString();

    return this.db.prepare(query).run(
      accountData.id,
      accountData.name,
      accountData.credentials.refreshToken,
      accountData.credentials.authMethod,
      accountData.credentials.clientId || null,
      accountData.credentials.clientSecret || null,
      accountData.credentials.region || null,
      accountData.credentials.machineId || null,
      accountData.credentials.profileArn || null,
      accountData.status || 'active',
      accountData.requestCount || 0,
      accountData.errorCount || 0,
      accountData.usage?.usageLimit || null,
      accountData.usage?.currentUsage || null,
      accountData.usage?.available || null,
      accountData.usage?.userEmail || null,
      accountData.usage?.subscriptionType || null,
      accountData.usage?.nextReset || null,
      accountData.usage?.updatedAt || null,
      accountData.createdAt || now,
      accountData.lastUsedAt || null
    );
  }

  /**
   * Update Kiro account statistics
   */
  updateKiroAccountStats(accountId) {
    const now = new Date().toISOString();
    return this.statements.updateKiroAccountStats.run(now, accountId);
  }

  /**
   * Update Kiro account error count
   */
  updateKiroAccountError(accountId) {
    const now = new Date().toISOString();
    return this.statements.updateKiroAccountError.run(now, accountId);
  }

  /**
   * Update Kiro account status
   */
  updateKiroAccountStatus(accountId, status) {
    const stmt = this.db.prepare(`
      UPDATE kiro_accounts
      SET status = ?
      WHERE id = ?
    `);
    return stmt.run(status, accountId);
  }

  /**
   * Update Kiro account usage information
   */
  updateKiroAccountUsage(accountId, usage) {
    const stmt = this.db.prepare(`
      UPDATE kiro_accounts
      SET usage_limit = ?,
          current_usage = ?,
          available = ?,
          user_email = ?,
          subscription_type = ?,
          next_reset = ?,
          usage_updated_at = ?
      WHERE id = ?
    `);

    // Ensure all values are primitive types (numbers, strings, or null)
    const usageLimit = typeof usage.usageLimit === 'number' ? usage.usageLimit : null;
    const currentUsage = typeof usage.currentUsage === 'number' ? usage.currentUsage : null;
    const available = typeof usage.available === 'number' ? usage.available : null;
    const userEmail = typeof usage.userEmail === 'string' ? usage.userEmail : null;
    const subscriptionType = typeof usage.subscriptionType === 'string' ? usage.subscriptionType : null;
    const nextReset = typeof usage.nextReset === 'string' ? usage.nextReset : null;
    const updatedAt = typeof usage.updatedAt === 'string' ? usage.updatedAt : new Date().toISOString();

    return stmt.run(
      usageLimit,
      currentUsage,
      available,
      userEmail,
      subscriptionType,
      nextReset,
      updatedAt,
      accountId
    );
  }

  /**
   * Delete Kiro account
   */
  deleteKiroAccount(accountId) {
    const stmt = this.db.prepare(`
      DELETE FROM kiro_accounts
      WHERE id = ?
    `);
    return stmt.run(accountId);
  }

  /**
   * Get system setting
   */
  getSetting(key) {
    const result = this.statements.getSetting.get(key);
    return result ? result.value : null;
  }

  /**
   * Set system setting
   */
  setSetting(key, value) {
    const now = new Date().toISOString();
    return this.statements.setSetting.run(key, value, now);
  }

  /**
   * Execute transaction
   */
  transaction(fn) {
    return this.db.transaction(fn)();
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      console.log('✓ Database connection closed');
    }
  }
}
