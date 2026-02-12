import { DatabaseManager } from './src/database.js';
import { SubscriptionManager } from './src/subscription.js';

const db = new DatabaseManager('./data/database.db');
db.init();

const subscription = new SubscriptionManager(db);

console.log('========== 订阅系统测试 ==========\n');

// 获取第一个用户
const users = db.getAllUsers();
if (users.length === 0) {
  console.log('没有找到用户');
  process.exit(0);
}

const testUser = users[0];
console.log(`测试用户: ${testUser.username} (ID: ${testUser.id})`);
console.log(`当前余额: $${testUser.balance.toFixed(4)}`);
console.log(`当前订阅: ${testUser.subscription_type || 'none'}\n`);

// 测试1: 设置每日订阅
console.log('测试1: 设置每日订阅（每天自动充值 $10，有效期 30 天）');
try {
  const result = subscription.setSubscription(testUser.id, 'daily', 10.0, 30);
  console.log('✓ 订阅设置成功');
  console.log(`  - 订阅类型: ${result.subscription_type}`);
  console.log(`  - 自动充值额度: $${result.subscription_quota}`);
  console.log(`  - 到期时间: ${result.subscription_expires_at}`);
  console.log(`  - 下次重置: ${result.next_reset}\n`);
} catch (error) {
  console.error('✗ 设置失败:', error.message);
}

// 测试2: 查看订阅信息
console.log('测试2: 查看订阅信息');
const updatedUser = db.getUserById(testUser.id);
console.log(`  - 订阅类型: ${updatedUser.subscription_type}`);
console.log(`  - 自动充值额度: $${updatedUser.subscription_quota}`);
console.log(`  - 到期时间: ${updatedUser.subscription_expires_at}`);
console.log(`  - 上次重置: ${updatedUser.last_reset_at || '从未'}`);
console.log(`  - 本期已用: $${(updatedUser.period_used || 0).toFixed(4)}\n`);

// 测试3: 手动触发重置检查
console.log('测试3: 手动触发重置检查');
try {
  subscription.checkAndResetQuotas();
  console.log('✓ 重置检查完成\n');
} catch (error) {
  console.error('✗ 检查失败:', error.message);
}

// 测试4: 查看重置日志
console.log('测试4: 查看重置日志');
const logs = db.db.prepare(`
  SELECT * FROM quota_reset_logs
  WHERE user_id = ?
  ORDER BY reset_at DESC
  LIMIT 5
`).all(testUser.id);

if (logs.length > 0) {
  console.log(`找到 ${logs.length} 条重置记录:`);
  logs.forEach((log, i) => {
    console.log(`  ${i + 1}. ${log.reset_at} - 充值 $${log.quota_amount} (${log.reset_type})`);
  });
} else {
  console.log('  暂无重置记录');
}
console.log();

// 测试5: 取消订阅
console.log('测试5: 取消订阅');
try {
  subscription.cancelSubscription(testUser.id);
  console.log('✓ 订阅已取消\n');
} catch (error) {
  console.error('✗ 取消失败:', error.message);
}

// 最终状态
const finalUser = db.getUserById(testUser.id);
console.log('最终状态:');
console.log(`  - 订阅类型: ${finalUser.subscription_type || 'none'}`);
console.log(`  - 余额: $${finalUser.balance.toFixed(4)}`);

console.log('\n========== 测试完成 ==========');
db.close();
