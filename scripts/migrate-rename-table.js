import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/database.db');
const migrationPath = path.join(__dirname, '../migrations/001-rename-agt-accounts.sql');

console.log('🚀 开始数据库迁移：agt_accounts → antigravity_accounts\n');

try {
    const db = new Database(dbPath);
    
    console.log('📊 迁移前状态：');
    const beforeCount = db.prepare('SELECT COUNT(*) as count FROM agt_accounts').get();
    console.log(`  - agt_accounts 表行数: ${beforeCount.count}`);
    
    console.log('\n🔄 执行迁移脚本...');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    db.exec(migrationSQL);
    
    console.log('\n✅ 迁移完成！\n');
    
    console.log('📊 迁移后状态：');
    const afterCount = db.prepare('SELECT COUNT(*) as count FROM antigravity_accounts').get();
    console.log(`  - antigravity_accounts 表行数: ${afterCount.count}`);
    
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='antigravity_accounts'").get();
    console.log(`  - antigravity_accounts 表存在: ${tableExists ? '✅' : '❌'}`);
    
    const oldTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agt_accounts'").get();
    console.log(`  - agt_accounts 表已删除: ${!oldTableExists ? '✅' : '❌'}`);
    
    if (beforeCount.count === afterCount.count) {
        console.log('\n✅ 数据完整性验证通过：行数匹配');
    } else {
        console.error('\n❌ 数据完整性验证失败：行数不匹配');
        process.exit(1);
    }
    
    db.close();
    console.log('\n🎉 数据库迁移成功完成！');
    
} catch (error) {
    console.error('\n❌ 迁移失败:', error.message);
    console.error(error.stack);
    process.exit(1);
}
