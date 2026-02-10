import Database from 'better-sqlite3';

/**
 * 订阅功能数据库迁移
 * 添加订阅套餐相关字段
 */

const DB_PATH = './data/database.db';

function migrate() {
  console.log('=== 开始订阅功能迁移 ===\n');

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  try {
    // 1. 添加订阅相关字段到 users 表
    console.log('步骤 1: 添加订阅字段到 users 表...');
    
    const columns = [
      // 订阅类型: 'none' (按量付费), 'daily' (每日套餐), 'monthly' (每月套餐)
      { name: 'subscription_type', type: 'TEXT', default: "'none'" },
      
      // 订阅额度（每日/每月自动充值的金额）
      { name: 'subscription_quota', type: 'REAL', default: '0.0' },
      
      // 订阅到期时间
      { name: 'subscription_expires_at', type: 'TEXT', default: 'NULL' },
      
      // 上次重置时间
      { name: 'last_reset_at', type: 'TEXT', default: 'NULL' },
      
      // 本周期已使用额度
      { name: 'period_used', type: 'REAL', default: '0.0' }
    ];

    for (const col of columns) {
      try {
        db.exec(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.default}`);
        console.log(`  ✓ 添加字段: ${col.name}`);
      } catch (error) {
        if (error.message.includes('duplicate column name')) {
          console.log(`  - 字段已存在: ${col.name}`);
        } else {
          throw error;
        }
      }
    }

    // 2. 创建订阅历史记录表
    console.log('\n步骤 2: 创建订阅历史表...');
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS subscription_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        subscription_type TEXT NOT NULL,
        quota REAL NOT NULL,
        duration_days INTEGER NOT NULL,
        amount_paid REAL NOT NULL,
        started_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        operator_id TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        
        FOREIGN KEY (user_id) REFERENCES users(id),
        CHECK (subscription_type IN ('daily', 'monthly')),
        CHECK (quota > 0),
        CHECK (duration_days > 0)
      )
    `);
    
    console.log('  ✓ 订阅历史表创建完成');

    // 3. 创建自动重置记录表
    console.log('\n步骤 3: 创建自动重置记录表...');
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS quota_reset_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        subscription_type TEXT NOT NULL,
        quota_amount REAL NOT NULL,
        balance_before REAL NOT NULL,
        balance_after REAL NOT NULL,
        reset_at TEXT NOT NULL,
        
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    
    console.log('  ✓ 自动重置记录表创建完成');

    // 4. 创建索引
    console.log('\n步骤 4: 创建索引...');
    
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_users_subscription_type ON users(subscription_type)',
      'CREATE INDEX IF NOT EXISTS idx_users_subscription_expires ON users(subscription_expires_at)',
      'CREATE INDEX IF NOT EXISTS idx_subscription_history_user_id ON subscription_history(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_quota_reset_logs_user_id ON quota_reset_logs(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_quota_reset_logs_reset_at ON quota_reset_logs(reset_at)'
    ];

    for (const indexSql of indexes) {
      db.exec(indexSql);
    }
    
    console.log('  ✓ 索引创建完成');

    // 5. 验证迁移
    console.log('\n步骤 5: 验证迁移...');
    
    const tables = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('subscription_history', 'quota_reset_logs')
    `).all();
    
    console.log(`  ✓ 新表数量: ${tables.length}`);
    
    const userColumns = db.prepare(`PRAGMA table_info(users)`).all();
    const subscriptionColumns = userColumns.filter(c => 
      c.name.includes('subscription') || c.name.includes('period') || c.name.includes('reset')
    );
    
    console.log(`  ✓ 新增用户字段: ${subscriptionColumns.length}`);

    console.log('\n=== 订阅功能迁移完成 ===');
    console.log('✓ 已添加订阅类型字段');
    console.log('✓ 已创建订阅历史表');
    console.log('✓ 已创建自动重置记录表');
    console.log('✓ 已创建相关索引');

  } catch (error) {
    console.error('\n✗ 迁移失败:', error);
    throw error;
  } finally {
    db.close();
  }
}

// 运行迁移
migrate();
