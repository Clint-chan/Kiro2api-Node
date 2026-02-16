import Database from "better-sqlite3/lib/index.js";
import fs from "fs";
import path from "path";
import { logger } from "./logger.js";

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
			this.db.pragma("journal_mode = WAL");

			// Enable foreign keys
			this.db.pragma("foreign_keys = ON");

			this.migrateRechargeRecordsConstraint();
			this.migrateRequestLogsForeignKey();
			this.ensureUserPermissionColumns();
			this.ensureAntigravityAccountsTable();

			// Prepare commonly used statements
			this.prepareStatements();

			logger.info("Database initialized successfully");
		} catch (error) {
			logger.error("Failed to initialize database", { error });
			throw error;
		}
	}

	migrateRechargeRecordsConstraint() {
		const tableMeta = this.db
			.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type = 'table' AND name = 'recharge_records'
    `)
			.get();

		if (!tableMeta || typeof tableMeta.sql !== "string") {
			return;
		}

		const normalizedSql = tableMeta.sql.toLowerCase().replace(/\s+/g, " ");
		if (!normalizedSql.includes("check (amount > 0)")) {
			return;
		}

		this.db.exec("BEGIN");
		try {
			this.db.exec(
				"ALTER TABLE recharge_records RENAME TO recharge_records_legacy",
			);
			this.db.exec(`
        CREATE TABLE recharge_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          amount REAL NOT NULL,
          balance_before REAL NOT NULL,
          balance_after REAL NOT NULL,
          operator_id TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,

          FOREIGN KEY (user_id) REFERENCES users(id),
          CHECK (amount != 0)
        )
      `);
			this.db.exec(`
        INSERT INTO recharge_records (
          id, user_id, amount, balance_before, balance_after,
          operator_id, notes, created_at
        )
        SELECT
          id, user_id, amount, balance_before, balance_after,
          operator_id, notes, created_at
        FROM recharge_records_legacy
      `);
			this.db.exec("DROP TABLE recharge_records_legacy");
			this.db.exec(
				"CREATE INDEX IF NOT EXISTS idx_recharge_records_user_id ON recharge_records(user_id)",
			);
			this.db.exec(
				"CREATE INDEX IF NOT EXISTS idx_recharge_records_created_at ON recharge_records(created_at)",
			);
			this.db.exec("COMMIT");
			logger.info(
				"Migrated recharge_records amount constraint to support balance adjustments",
			);
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	migrateRequestLogsForeignKey() {
		// Check if request_logs table has the wrong foreign key reference
		const tableMeta = this.db
			.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type = 'table' AND name = 'request_logs'
    `)
			.get();

		if (!tableMeta || typeof tableMeta.sql !== "string") {
			return;
		}

		// Check if it references kiro_accounts_old
		if (!tableMeta.sql.includes("kiro_accounts_old")) {
			return;
		}

		logger.info(
			"Migrating request_logs foreign key from kiro_accounts_old to kiro_accounts",
		);

		// Disable foreign keys temporarily for migration
		this.db.pragma("foreign_keys = OFF");

		this.db.exec("BEGIN");
		try {
			// Rename old table
			this.db.exec("ALTER TABLE request_logs RENAME TO request_logs_old");

			// Create new table with correct foreign key
			this.db.exec(`
        CREATE TABLE request_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,

          -- User information
          user_id TEXT NOT NULL,
          user_api_key TEXT NOT NULL,

          -- Kiro account information
          kiro_account_id TEXT NOT NULL,
          kiro_account_name TEXT NOT NULL,

          -- Request information
          model TEXT NOT NULL,
          input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          duration_ms INTEGER NOT NULL,

          -- Billing information
          input_cost REAL NOT NULL,
          output_cost REAL NOT NULL,
          total_cost REAL NOT NULL,

          -- Status
          success INTEGER NOT NULL,
          error_message TEXT,
          timestamp TEXT NOT NULL,

          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (kiro_account_id) REFERENCES kiro_accounts(id)
        )
      `);

			// Copy data from old table
			this.db.exec(`
        INSERT INTO request_logs (
          id, user_id, user_api_key, kiro_account_id, kiro_account_name,
          model, input_tokens, output_tokens, duration_ms,
          input_cost, output_cost, total_cost,
          success, error_message, timestamp
        )
        SELECT
          id, user_id, user_api_key, kiro_account_id, kiro_account_name,
          model, input_tokens, output_tokens, duration_ms,
          input_cost, output_cost, total_cost,
          success, error_message, timestamp
        FROM request_logs_old
      `);

			// Drop old table
			this.db.exec("DROP TABLE request_logs_old");

			// Recreate indexes
			this.db.exec(
				"CREATE INDEX IF NOT EXISTS idx_request_logs_user_id ON request_logs(user_id)",
			);
			this.db.exec(
				"CREATE INDEX IF NOT EXISTS idx_request_logs_kiro_account_id ON request_logs(kiro_account_id)",
			);
			this.db.exec(
				"CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp)",
			);

			this.db.exec("COMMIT");

			// Re-enable foreign keys
			this.db.pragma("foreign_keys = ON");

			logger.info("Successfully migrated request_logs foreign key");
		} catch (error) {
			this.db.exec("ROLLBACK");
			this.db.pragma("foreign_keys = ON");
			logger.error("Failed to migrate request_logs foreign key", { error });
			throw error;
		}
	}

	/**
	 * Prepare frequently used SQL statements
	 */
	prepareStatements() {
		// User queries
		this.statements.getUserByApiKey = this.db.prepare(
			"SELECT * FROM users WHERE api_key = ? AND status = ?",
		);

		this.statements.getUserById = this.db.prepare(
			"SELECT * FROM users WHERE id = ?",
		);

		this.statements.updateUserBalance = this.db.prepare(
			"UPDATE users SET balance = ?, updated_at = ? WHERE id = ?",
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
        allowed_channels, allowed_models,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		// Request log queries
		this.statements.insertRequestLog = this.db.prepare(`
      INSERT INTO request_logs (
        user_id, kiro_account_id, kiro_account_name,
        model, input_tokens, output_tokens, duration_ms,
        input_cost, output_cost, total_cost,
        success, error_message, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		// Kiro account queries
		this.statements.getKiroAccountById = this.db.prepare(
			"SELECT * FROM kiro_accounts WHERE id = ?",
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
			"SELECT value FROM system_settings WHERE key = ?",
		);

		this.statements.setSetting = this.db.prepare(`
      INSERT OR REPLACE INTO system_settings (key, value, updated_at)
      VALUES (?, ?, ?)
    `);

		this.statements.deleteSetting = this.db.prepare(
			"DELETE FROM system_settings WHERE key = ?",
		);
	}

	ensureUserPermissionColumns() {
		const existingColumns = this.db.prepare("PRAGMA table_info(users)").all();
		const columnNames = new Set(existingColumns.map((column) => column.name));

		if (!columnNames.has("allowed_channels")) {
			this.db.exec(
				`ALTER TABLE users ADD COLUMN allowed_channels TEXT NOT NULL DEFAULT '["kiro"]'`,
			);
		}

		if (!columnNames.has("allowed_models")) {
			this.db.exec("ALTER TABLE users ADD COLUMN allowed_models TEXT");
		}

		this.db
			.prepare(`
      UPDATE users
      SET allowed_channels = '["kiro"]'
      WHERE allowed_channels IS NULL
         OR TRIM(allowed_channels) = ''
    `)
			.run();
	}

	/**
	 * Get user by API key
	 */
	getUserByApiKey(apiKey, status = "active") {
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
		const allowedChannels = Array.isArray(userData.allowed_channels)
			? JSON.stringify(userData.allowed_channels)
			: '["kiro"]';
		const allowedModels =
			Array.isArray(userData.allowed_models) &&
			userData.allowed_models.length > 0
				? JSON.stringify(userData.allowed_models)
				: null;

		return this.statements.insertUser.run(
			userData.id,
			userData.username,
			userData.api_key,
			userData.role || "user",
			userData.balance || 0.0,
			userData.status || "active",
			userData.price_input || 3.0,
			userData.price_output || 15.0,
			allowedChannels,
			allowedModels,
			now,
			now,
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
			userId,
		);
	}

	/**
	 * Insert request log
	 */
	insertRequestLog(logData) {
		return this.statements.insertRequestLog.run(
			logData.user_id,
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
			logData.timestamp,
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
			query += " AND timestamp >= ?";
			params.push(startDate);
		}

		if (endDate) {
			query += " AND timestamp <= ?";
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
			query += " AND timestamp >= ?";
			params.push(startDate);
		}

		if (endDate) {
			query += " AND timestamp <= ?";
			params.push(endDate);
		}

		query += " GROUP BY model ORDER BY total_cost DESC";

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
		let query = "SELECT * FROM users";
		const params = [];

		if (status) {
			query += " WHERE status = ?";
			params.push(status);
		}

		query += " ORDER BY created_at DESC";

		return this.db.prepare(query).all(...params);
	}

	/**
	 * Update user
	 */
	updateUser(userId, updates) {
		const allowedFields = [
			"username",
			"balance",
			"status",
			"role",
			"price_input",
			"price_output",
			"notes",
			"allowed_channels",
			"allowed_models",
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

		fields.push("updated_at = ?");
		values.push(new Date().toISOString());
		values.push(userId);

		const query = `UPDATE users SET ${fields.join(", ")} WHERE id = ?`;
		return this.db.prepare(query).run(...values);
	}

	/**
	 * Delete user
	 */
	deleteUser(userId) {
		// 删除用户前，先删除相关的记录
		// 1. 删除请求日志
		this.db.prepare("DELETE FROM request_logs WHERE user_id = ?").run(userId);

		// 2. 删除充值记录
		this.db
			.prepare("DELETE FROM recharge_records WHERE user_id = ?")
			.run(userId);

		// 3. 删除订阅历史
		this.db
			.prepare("DELETE FROM subscription_history WHERE user_id = ?")
			.run(userId);

		// 4. 删除额度重置日志
		this.db
			.prepare("DELETE FROM quota_reset_logs WHERE user_id = ?")
			.run(userId);

		// 5. 最后删除用户
		return this.db.prepare("DELETE FROM users WHERE id = ?").run(userId);
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

		return this.db
			.prepare(query)
			.run(
				data.user_id,
				data.amount,
				data.balance_before,
				data.balance_after,
				data.operator_id || null,
				data.notes || null,
				new Date().toISOString(),
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
		let query = "SELECT * FROM kiro_accounts";
		const params = [];

		if (status) {
			query += " WHERE status = ?";
			params.push(status);
		}

		query += " ORDER BY created_at DESC";

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

		return this.db
			.prepare(query)
			.run(
				accountData.id,
				accountData.name,
				accountData.credentials.refreshToken,
				accountData.credentials.authMethod,
				accountData.credentials.clientId || null,
				accountData.credentials.clientSecret || null,
				accountData.credentials.region || null,
				accountData.credentials.machineId || null,
				accountData.credentials.profileArn || null,
				accountData.status || "active",
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
				accountData.lastUsedAt || null,
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

	ensureAntigravityAccountsTable() {
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS antigravity_accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        project_id TEXT,
        access_token TEXT,
        refresh_token TEXT NOT NULL,
        expires_in INTEGER,
        expired TEXT,
        timestamp INTEGER,
        type TEXT NOT NULL DEFAULT 'antigravity',
        status TEXT NOT NULL DEFAULT 'active',
        plan_tier TEXT,
        paid_tier TEXT,
        next_reset TEXT,
        model_quotas TEXT,
        last_usage_sync_at TEXT,
        request_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        updated_at TEXT NOT NULL,
        CHECK (status IN ('active', 'inactive', 'error', 'disabled'))
      )
    `);

		this.db.exec(
			"CREATE INDEX IF NOT EXISTS idx_antigravity_accounts_status ON antigravity_accounts(status)",
		);
		this.db.exec(
			"CREATE INDEX IF NOT EXISTS idx_antigravity_accounts_email ON antigravity_accounts(email)",
		);
		this.db.exec(
			"CREATE INDEX IF NOT EXISTS idx_antigravity_accounts_project_id ON antigravity_accounts(project_id)",
		);

		const existingColumns = this.db
			.prepare("PRAGMA table_info(antigravity_accounts)")
			.all();
		const columnNames = new Set(existingColumns.map((column) => column.name));
		const migrations = [
			[
				"plan_tier",
				"ALTER TABLE antigravity_accounts ADD COLUMN plan_tier TEXT",
			],
			[
				"paid_tier",
				"ALTER TABLE antigravity_accounts ADD COLUMN paid_tier TEXT",
			],
			[
				"next_reset",
				"ALTER TABLE antigravity_accounts ADD COLUMN next_reset TEXT",
			],
			[
				"model_quotas",
				"ALTER TABLE antigravity_accounts ADD COLUMN model_quotas TEXT",
			],
			[
				"last_usage_sync_at",
				"ALTER TABLE antigravity_accounts ADD COLUMN last_usage_sync_at TEXT",
			],
		];

		for (const [column, migration] of migrations) {
			if (!columnNames.has(column)) {
				this.db.exec(migration);
			}
		}
	}

	updateKiroAccountMachineId(accountId, machineId) {
		const stmt = this.db.prepare(`
      UPDATE kiro_accounts
      SET machine_id = ?
      WHERE id = ?
    `);
		return stmt.run(machineId, accountId);
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
		const usageLimit =
			typeof usage.usageLimit === "number" ? usage.usageLimit : null;
		const currentUsage =
			typeof usage.currentUsage === "number" ? usage.currentUsage : null;
		const available =
			typeof usage.available === "number" ? usage.available : null;
		const userEmail =
			typeof usage.userEmail === "string" ? usage.userEmail : null;
		const subscriptionType =
			typeof usage.subscriptionType === "string"
				? usage.subscriptionType
				: null;
		const nextReset =
			typeof usage.nextReset === "string" ? usage.nextReset : null;
		const updatedAt =
			typeof usage.updatedAt === "string"
				? usage.updatedAt
				: new Date().toISOString();

		return stmt.run(
			usageLimit,
			currentUsage,
			available,
			userEmail,
			subscriptionType,
			nextReset,
			updatedAt,
			accountId,
		);
	}

	/**
	 * Delete Kiro account
	 */
	deleteKiroAccount(accountId) {
		this.db
			.prepare("DELETE FROM request_logs WHERE kiro_account_id = ?")
			.run(accountId);

		const stmt = this.db.prepare(`
      DELETE FROM kiro_accounts
      WHERE id = ?
    `);
		return stmt.run(accountId);
	}

	getAntigravityAccountById(id) {
		const stmt = this.db.prepare(
			"SELECT * FROM antigravity_accounts WHERE id = ?",
		);
		return stmt.get(id);
	}

	getAgtAccountById(id) {
		return this.getAntigravityAccountById(id);
	}

	getAllAntigravityAccounts(status = null) {
		let query = "SELECT * FROM antigravity_accounts";
		const params = [];

		if (status) {
			query += " WHERE status = ?";
			params.push(status);
		}

		query += " ORDER BY created_at DESC";
		return this.db.prepare(query).all(...params);
	}

	insertAntigravityAccount(accountData) {
		const query = `
      INSERT INTO antigravity_accounts (
        id, name, email, project_id,
        access_token, refresh_token,
        expires_in, expired, timestamp,
        type, status, plan_tier, paid_tier, next_reset, model_quotas, last_usage_sync_at,
        request_count, error_count,
        created_at, last_used_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

		const now = new Date().toISOString();
		return this.db
			.prepare(query)
			.run(
				accountData.id,
				accountData.name,
				accountData.email || null,
				accountData.project_id || null,
				accountData.access_token || null,
				accountData.refresh_token,
				accountData.expires_in || null,
				accountData.expired || null,
				accountData.timestamp || null,
				accountData.type || "antigravity",
				accountData.status || "active",
				accountData.plan_tier || null,
				accountData.paid_tier || null,
				accountData.next_reset || null,
				accountData.model_quotas || null,
				accountData.last_usage_sync_at || null,
				accountData.request_count || 0,
				accountData.error_count || 0,
				accountData.created_at || now,
				accountData.last_used_at || null,
				accountData.updated_at || now,
			);
	}

	updateAntigravityAccountStatus(accountId, status) {
		const stmt = this.db.prepare(`
      UPDATE antigravity_accounts
      SET status = ?, updated_at = ?
      WHERE id = ?
    `);
		return stmt.run(status, new Date().toISOString(), accountId);
	}

	updateAntigravityAccountStats(accountId, isError = false) {
		const now = new Date().toISOString();
		const stmt = this.db.prepare(`
      UPDATE antigravity_accounts
      SET request_count = request_count + 1,
          error_count = error_count + ?,
          last_used_at = ?,
          updated_at = ?
      WHERE id = ?
    `);
		return stmt.run(isError ? 1 : 0, now, now, accountId);
	}

	updateAntigravityAccountTokens(accountId, updates) {
		const stmt = this.db.prepare(`
      UPDATE antigravity_accounts
      SET access_token = ?,
          refresh_token = ?,
          expires_in = ?,
          expired = ?,
          timestamp = ?,
          project_id = ?,
          email = ?,
          updated_at = ?
      WHERE id = ?
    `);

		return stmt.run(
			updates.access_token || null,
			updates.refresh_token || null,
			updates.expires_in || null,
			updates.expired || null,
			updates.timestamp || null,
			updates.project_id || null,
			updates.email || null,
			new Date().toISOString(),
			accountId,
		);
	}

	updateAntigravityAccountUsageMeta(accountId, updates) {
		const stmt = this.db.prepare(`
      UPDATE antigravity_accounts
      SET plan_tier = ?,
          paid_tier = ?,
          next_reset = ?,
          model_quotas = ?,
          last_usage_sync_at = ?,
          updated_at = ?
      WHERE id = ?
    `);

		return stmt.run(
			updates.plan_tier || null,
			updates.paid_tier || null,
			updates.next_reset || null,
			updates.model_quotas || null,
			updates.last_usage_sync_at || new Date().toISOString(),
			new Date().toISOString(),
			accountId,
		);
	}

	deleteAntigravityAccount(accountId) {
		const stmt = this.db.prepare(
			"DELETE FROM antigravity_accounts WHERE id = ?",
		);
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
	 * Delete system setting
	 */
	deleteSetting(key) {
		return this.statements.deleteSetting.run(key);
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
			console.log("✓ Database connection closed");
		}
	}
}
