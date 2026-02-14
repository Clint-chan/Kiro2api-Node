import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/database.db');

console.log('🚀 开始数据迁移：agt_accounts → antigravity_accounts\n');

try {
    const db = new Database(dbPath);
    
    console.log('📊 迁移前状态：');
    const beforeCount = db.prepare('SELECT COUNT(*) as count FROM agt_accounts').get();
    console.log(`  - agt_accounts 行数: ${beforeCount.count}`);
    
    const antigravityBefore = db.prepare('SELECT COUNT(*) as count FROM antigravity_accounts').get();
    console.log(`  - antigravity_accounts 行数: ${antigravityBefore.count}`);
    
    console.log('\n🔄 开始迁移数据...');
    
    db.exec('BEGIN IMMEDIATE TRANSACTION');
    
    db.exec('INSERT INTO antigravity_accounts SELECT * FROM agt_accounts');
    
    const afterCount = db.prepare('SELECT COUNT(*) as count FROM antigravity_accounts').get();
    console.log(`  - 已复制 ${afterCount.count} 行数据`);
    
    if (beforeCount.count !== afterCount.count) {
        console.error('\n❌ 数据验证失败：行数不匹配');
        db.exec('ROLLBACK');
        process.exit(1);
    }
    
    console.log('\n🗑️  删除旧表和索引...');
    db.exec('DROP INDEX IF EXISTS idx_agt_accounts_status');
    db.exec('DROP INDEX IF EXISTS idx_agt_accounts_email');
    db.exec('DROP INDEX IF EXISTS idx_agt_accounts_project_id');
    db.exec('DROP TABLE agt_accounts');
    
    db.exec('COMMIT');
    
    console.log('\n✅ 迁移完成！\n');
    
    console.log('📊 迁移后状态：');
    const finalCount = db.prepare('SELECT COUNT(*) as count FROM antigravity_accounts').get();
    console.log(`  - antigravity_accounts 行数: ${finalCount.count}`);
    
    const oldTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agt_accounts'").get();
    console.log(`  - agt_accounts 表已删除: ${!oldTableExists ? '✅' : '❌'}`);
    
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='antigravity_accounts'").all();
    console.log(`  - antigravity_accounts 索引数: ${indexes.length}`);
    
    db.close();
    console.log('\n🎉 数据库迁移成功完成！');
    
} catch (error) {
    console.error('\n❌ 迁移失败:', error.message);
    console.error(error.stack);
    process.exit(1);
}
