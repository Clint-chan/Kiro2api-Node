-- ============================================
-- 迁移验证脚本
-- ============================================

-- 1. 检查表是否存在
SELECT CASE 
    WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='antigravity_accounts')
    THEN '✅ PASS: Table antigravity_accounts exists'
    ELSE '❌ FAIL: Table antigravity_accounts not found'
END as table_check;

-- 2. 检查旧表是否已删除
SELECT CASE 
    WHEN NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='agt_accounts')
    THEN '✅ PASS: Old table agt_accounts removed'
    ELSE '⚠️  WARNING: Old table agt_accounts still exists'
END as old_table_check;

-- 3. 验证行数
SELECT COUNT(*) as total_rows FROM antigravity_accounts;

-- 4. 验证索引
SELECT name, sql 
FROM sqlite_master 
WHERE type='index' AND tbl_name='antigravity_accounts'
ORDER BY name;

-- 5. 验证约束
SELECT sql 
FROM sqlite_master 
WHERE type='table' AND name='antigravity_accounts';

-- 6. 检查外键引用（如果有其他表引用此表）
SELECT m.name as referencing_table, m.sql
FROM sqlite_master m
WHERE m.sql LIKE '%antigravity_accounts%' 
  AND m.type IN ('table', 'trigger', 'view')
  AND m.name != 'antigravity_accounts';

-- 7. 数据抽样检查
SELECT * FROM antigravity_accounts LIMIT 5;

-- 8. 检查数据类型和约束
PRAGMA table_info(antigravity_accounts);

-- 9. 外键完整性检查
PRAGMA foreign_key_check;

-- 10. 数据库完整性检查
PRAGMA integrity_check;
