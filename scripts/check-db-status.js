import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../data/database.db');

console.log('📊 检查数据库当前状态\n');

try {
    const db = new Database(dbPath);
    
    const agtExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agt_accounts'").get();
    const antigravityExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='antigravity_accounts'").get();
    
    console.log('表存在状态：');
    console.log(`  - agt_accounts: ${agtExists ? '✅ 存在' : '❌ 不存在'}`);
    console.log(`  - antigravity_accounts: ${antigravityExists ? '✅ 存在' : '❌ 不存在'}`);
    
    if (agtExists) {
        const agtCount = db.prepare('SELECT COUNT(*) as count FROM agt_accounts').get();
        console.log(`  - agt_accounts 行数: ${agtCount.count}`);
    }
    
    if (antigravityExists) {
        const antigravityCount = db.prepare('SELECT COUNT(*) as count FROM antigravity_accounts').get();
        console.log(`  - antigravity_accounts 行数: ${antigravityCount.count}`);
    }
    
    console.log('\n索引状态：');
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND (tbl_name='agt_accounts' OR tbl_name='antigravity_accounts')").all();
    indexes.forEach(idx => {
        console.log(`  - ${idx.name}`);
    });
    
    db.close();
    
    if (agtExists && antigravityExists) {
        console.log('\n⚠️  两个表都存在！需要手动迁移数据。');
    } else if (!agtExists && antigravityExists) {
        console.log('\n✅ 迁移已完成（只有 antigravity_accounts 表存在）');
    } else if (agtExists && !antigravityExists) {
        console.log('\n⚠️  需要执行迁移（只有 agt_accounts 表存在）');
    }
    
} catch (error) {
    console.error('\n❌ 检查失败:', error.message);
    process.exit(1);
}
