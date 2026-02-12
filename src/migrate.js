import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';

/**
 * Data Migration Script
 * Migrates data from JSON files to SQLite database
 */

const DATA_DIR = './data';
const BACKUP_DIR = './data/backup';
const DB_PATH = './data/database.db';
const SCHEMA_PATH = './schema.sql';

class DataMigration {
  constructor() {
    this.db = null;
  }

  /**
   * Main migration process
   */
  async migrate() {
    try {
      console.log('=== Starting Data Migration ===\n');

      // Step 1: Backup existing data
      await this.backupExistingData();

      // Step 2: Initialize database
      await this.initializeDatabase();

      // Step 3: Migrate system settings
      await this.migrateSystemSettings();

      // Step 4: Migrate Kiro accounts
      await this.migrateKiroAccounts();

      // Step 5: Migrate request logs
      await this.migrateRequestLogs();

      // Step 6: Verify migration
      await this.verifyMigration();

      console.log('\n=== Migration Completed Successfully ===');
      console.log('✓ All data has been migrated to SQLite database');
      console.log(`✓ Database location: ${DB_PATH}`);
      console.log(`✓ Backup location: ${BACKUP_DIR}`);

    } catch (error) {
      console.error('\n✗ Migration failed:', error);
      throw error;
    } finally {
      if (this.db) {
        this.db.close();
      }
    }
  }

  /**
   * Backup existing JSON files
   */
  async backupExistingData() {
    console.log('Step 1: Backing up existing data...');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, timestamp);

    await fs.mkdir(backupPath, { recursive: true });

    const filesToBackup = ['settings.json', 'accounts.json', 'request_logs.json'];

    for (const file of filesToBackup) {
      const sourcePath = path.join(DATA_DIR, file);
      const destPath = path.join(backupPath, file);

      try {
        await fs.copyFile(sourcePath, destPath);
        console.log(`  ✓ Backed up ${file}`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        console.log(`  - ${file} not found, skipping`);
      }
    }

    console.log(`✓ Backup completed: ${backupPath}\n`);
  }

  /**
   * Initialize database with schema
   */
  async initializeDatabase() {
    console.log('Step 2: Initializing database...');

    // Read schema file
    const schema = await fs.readFile(SCHEMA_PATH, 'utf-8');

    // Create database
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Execute schema
    this.db.exec(schema);

    console.log('✓ Database initialized with schema\n');
  }

  /**
   * Migrate system settings and create users
   */
  async migrateSystemSettings() {
    console.log('Step 3: Migrating system settings...');

    try {
      const settingsPath = path.join(DATA_DIR, 'settings.json');
      const settingsData = await fs.readFile(settingsPath, 'utf-8');
      const settings = JSON.parse(settingsData);

      const now = new Date().toISOString();

      // Insert admin key as system setting
      this.db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (?, ?, ?)
      `).run('admin_key', settings.adminKey, now);

      console.log('  ✓ Migrated admin key');

      // Insert default prices
      this.db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (?, ?, ?)
      `).run('default_price_input', '3.0', now);

      this.db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (?, ?, ?)
      `).run('default_price_output', '15.0', now);

      console.log('  ✓ Set default prices');

      // Create admin user
      const adminId = uuidv4();
      this.db.prepare(`
        INSERT INTO users (
          id, username, api_key, role, balance, status,
          price_input, price_output,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        adminId,
        'admin',
        settings.adminKey,
        'admin',
        0.0,
        'active',
        3.0,
        15.0,
        now,
        now
      );

      console.log('  ✓ Created admin user');

      // Create users from API keys
      let userCount = 0;
      for (const apiKey of settings.apiKeys || []) {
        if (apiKey === settings.adminKey) {
          continue; // Skip admin key
        }

        const userId = uuidv4();
        this.db.prepare(`
          INSERT INTO users (
            id, username, api_key, role, balance, status,
            price_input, price_output,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          userId,
          `user_${apiKey.substring(0, 8)}`,
          apiKey,
          'user',
          0.0,
          'active',
          3.0,
          15.0,
          now,
          now
        );

        userCount++;
      }

      console.log(`  ✓ Created ${userCount} user accounts`);
      console.log(`✓ System settings migrated\n`);

    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('  - settings.json not found, using defaults');

        // Create default admin
        const now = new Date().toISOString();
        const adminKey = 'admin-default-key';
        const adminId = uuidv4();

        this.db.prepare(`
          INSERT INTO system_settings (key, value, updated_at)
          VALUES (?, ?, ?)
        `).run('admin_key', adminKey, now);

        this.db.prepare(`
          INSERT INTO users (
            id, username, api_key, role, balance, status,
            price_input, price_output,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          adminId,
          'admin',
          adminKey,
          'admin',
          0.0,
          'active',
          3.0,
          15.0,
          now,
          now
        );

        console.log('  ✓ Created default admin user\n');
      } else {
        throw error;
      }
    }
  }

  /**
   * Migrate Kiro accounts
   */
  async migrateKiroAccounts() {
    console.log('Step 4: Migrating Kiro accounts...');

    try {
      const accountsPath = path.join(DATA_DIR, 'accounts.json');
      const accountsData = await fs.readFile(accountsPath, 'utf-8');
      const accounts = JSON.parse(accountsData);

      const insertStmt = this.db.prepare(`
        INSERT INTO kiro_accounts (
          id, name, refresh_token, auth_method,
          client_id, client_secret, region, machine_id, profile_arn,
          status, request_count, error_count,
          usage_limit, current_usage, available,
          user_email, subscription_type, next_reset, usage_updated_at,
          created_at, last_used_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let count = 0;
      for (const account of accounts) {
        insertStmt.run(
          account.id,
          account.name,
          account.credentials.refreshToken,
          account.credentials.authMethod,
          account.credentials.clientId || null,
          account.credentials.clientSecret || null,
          account.credentials.region || null,
          account.credentials.machineId || null,
          account.credentials.profileArn || null,
          account.status || 'active',
          account.requestCount || 0,
          account.errorCount || 0,
          account.usage?.usageLimit || null,
          account.usage?.currentUsage || null,
          account.usage?.available || null,
          account.usage?.userEmail || null,
          account.usage?.subscriptionType || null,
          account.usage?.nextReset || null,
          account.usage?.updatedAt || null,
          account.createdAt || new Date().toISOString(),
          account.lastUsedAt || null
        );
        count++;
      }

      console.log(`  ✓ Migrated ${count} Kiro accounts`);
      console.log(`✓ Kiro accounts migrated\n`);

    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('  - accounts.json not found, skipping\n');
      } else {
        throw error;
      }
    }
  }

  /**
   * Migrate request logs
   */
  async migrateRequestLogs() {
    console.log('Step 5: Migrating request logs...');

    try {
      const logsPath = path.join(DATA_DIR, 'request_logs.json');
      const logsData = await fs.readFile(logsPath, 'utf-8');
      const logs = JSON.parse(logsData);

      // Get default user (first user or admin)
      const defaultUser = this.db.prepare('SELECT * FROM users LIMIT 1').get();

      if (!defaultUser) {
        console.log('  - No users found, skipping log migration\n');
        return;
      }

      // Get all existing kiro account IDs
      const existingAccounts = this.db.prepare('SELECT id FROM kiro_accounts').all();
      const accountIds = new Set(existingAccounts.map(a => a.id));

      const insertStmt = this.db.prepare(`
        INSERT INTO request_logs (
          user_id, user_api_key, kiro_account_id, kiro_account_name,
          model, input_tokens, output_tokens, duration_ms,
          input_cost, output_cost, total_cost,
          success, error_message, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let count = 0;
      let skipped = 0;
      const batchSize = 1000;

      // Process in batches for better performance
      const insertMany = this.db.transaction((batch) => {
        for (const log of batch) {
          // Skip logs with non-existent account IDs
          if (!accountIds.has(log.accountId)) {
            skipped++;
            continue;
          }

          // Calculate costs (assuming default prices)
          const inputCost = (log.inputTokens / 1000000) * 3.0;
          const outputCost = (log.outputTokens / 1000000) * 15.0;
          const totalCost = inputCost + outputCost;

          insertStmt.run(
            defaultUser.id,
            defaultUser.api_key,
            log.accountId,
            log.accountName,
            log.model,
            log.inputTokens || 0,
            log.outputTokens || 0,
            log.durationMs || 0,
            inputCost,
            outputCost,
            totalCost,
            log.success ? 1 : 0,
            log.errorMessage || null,
            log.timestamp
          );
        }
      });

      // Process logs in batches
      for (let i = 0; i < logs.length; i += batchSize) {
        const batch = logs.slice(i, i + batchSize);
        insertMany(batch);
        count += batch.length - skipped;

        if (count % 10000 === 0) {
          console.log(`  - Migrated ${count} logs...`);
        }
      }

      console.log(`  ✓ Migrated ${count} request logs`);
      if (skipped > 0) {
        console.log(`  - Skipped ${skipped} logs with non-existent account IDs`);
      }
      console.log(`✓ Request logs migrated\n`);

    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('  - request_logs.json not found, skipping\n');
      } else {
        throw error;
      }
    }
  }

  /**
   * Verify migration
   */
  async verifyMigration() {
    console.log('Step 6: Verifying migration...');

    // Count records
    const userCount = this.db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const accountCount = this.db.prepare('SELECT COUNT(*) as count FROM kiro_accounts').get().count;
    const logCount = this.db.prepare('SELECT COUNT(*) as count FROM request_logs').get().count;
    const settingCount = this.db.prepare('SELECT COUNT(*) as count FROM system_settings').get().count;

    console.log(`  ✓ Users: ${userCount}`);
    console.log(`  ✓ Kiro Accounts: ${accountCount}`);
    console.log(`  ✓ Request Logs: ${logCount}`);
    console.log(`  ✓ System Settings: ${settingCount}`);

    // Verify indexes
    const indexes = this.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name LIKE 'idx_%'
    `).all();

    console.log(`  ✓ Indexes created: ${indexes.length}`);
    console.log('✓ Migration verified\n');
  }
}

// Run migration
const migration = new DataMigration();
migration.migrate().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});
