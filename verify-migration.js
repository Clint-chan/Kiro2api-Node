import Database from 'better-sqlite3';

const db = new Database('./data/database.db', { readonly: true });

console.log('=== 数据库迁移验证 ===\n');

// 检查表
const tables = db.prepare(`
  SELECT name FROM sqlite_master 
  WHERE type='table' AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`).all();

console.log('✓ 数据表：');
tables.forEach(t => console.log(`  - ${t.name}`));

// 统计数据
console.log('\n✓ 数据统计：');

const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
console.log(`  - 用户数：${userCount.count}`);

const accountCount = db.prepare('SELECT COUNT(*) as count FROM kiro_accounts').get();
console.log(`  - Kiro账号数：${accountCount.count}`);

const logCount = db.prepare('SELECT COUNT(*) as count FROM request_logs').get();
console.log(`  - 请求日志数：${logCount.count}`);

const settingCount = db.prepare('SELECT COUNT(*) as count FROM system_settings').get();
console.log(`  - 系统设置数：${settingCount.count}`);

// 检查账号状态
console.log('\n✓ Kiro账号状态：');
const accountStatus = db.prepare(`
  SELECT status, COUNT(*) as count 
  FROM kiro_accounts 
  GROUP BY status
`).all();
accountStatus.forEach(s => console.log(`  - ${s.status}: ${s.count}`));

// 检查用户
console.log('\n✓ 用户列表：');
const users = db.prepare('SELECT username, role, balance, status FROM users').all();
users.forEach(u => {
  console.log(`  - ${u.username} (${u.role}): 余额 $${u.balance.toFixed(2)}, 状态 ${u.status}`);
});

// 检查系统设置
console.log('\n✓ 系统设置：');
const settings = db.prepare('SELECT key, value FROM system_settings').all();
settings.forEach(s => {
  const value = s.key.includes('key') ? '***' : s.value;
  console.log(`  - ${s.key}: ${value}`);
});

db.close();

console.log('\n=== 验证完成 ===');
