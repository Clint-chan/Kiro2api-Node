/**
 * 订阅系统补充迁移脚本
 * 添加缺失的 reset_type 列
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../data/database.db');

console.log('========== 订阅系统补充迁移 ==========\n');
console.log('数据库路径:', dbPath);

const db = new Database(dbPath);

try {
  console.log('\n开始补充迁移...\n');

  // 检查列是否已存在
  const tableInfo = db.prepare("PRAGMA table_info(quota_reset_logs)").all();
  const hasResetType = tableInfo.some(col => col.name === 'reset_type');

  if (hasResetType) {
    console.log('✓ reset_type 列已存在，无需迁移');
  } else {
    console.log('步骤 1: 添加 reset_type 列到 quota_reset_logs 表...');
    
    db.exec(`
      ALTER TABLE quota_reset_logs 
      ADD COLUMN reset_type TEXT DEFAULT 'scheduled'
    `);
    
    console.log('  ✓ reset_type 列添加完成');
    
    // 更新现有记录
    console.log('\n步骤 2: 更新现有记录的 reset_type...');
    const result = db.prepare(`
      UPDATE quota_reset_logs 
      SET reset_type = 'initial' 
      WHERE reset_type IS NULL OR reset_type = 'scheduled'
    `).run();
    
    console.log(`  ✓ 更新了 ${result.changes} 条记录`);
  }

  console.log('\n========== 补充迁移完成 ==========');
  
} catch (error) {
  console.error('\n❌ 迁移失败:', error.message);
  console.error(error.stack);
  process.exit(1);
} finally {
  db.close();
  console.log('\n✓ 数据库连接已关闭');
}
