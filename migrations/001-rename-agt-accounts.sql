-- ============================================
-- SQLite 表重命名：agt_accounts → antigravity_accounts
-- 生产级迁移脚本 v1.0
-- ============================================

-- 步骤 1: 开启事务
BEGIN IMMEDIATE TRANSACTION;

-- 步骤 2: 备份验证数据
CREATE TEMP TABLE _migration_backup AS 
SELECT COUNT(*) as row_count, 
       COUNT(DISTINCT id) as unique_ids,
       MAX(created_at) as latest_record
FROM agt_accounts;

-- 步骤 3: 执行重命名
ALTER TABLE agt_accounts RENAME TO antigravity_accounts;

-- 步骤 4: 验证数据完整性
SELECT CASE 
    WHEN (SELECT COUNT(*) FROM antigravity_accounts) = (SELECT row_count FROM _migration_backup)
    THEN 'PASS: Row count matches'
    ELSE 'FAIL: Row count mismatch'
END as validation_result;

-- 步骤 5: 验证索引存在
SELECT CASE
    WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='index' AND tbl_name='antigravity_accounts')
    THEN 'PASS: Indexes migrated'
    ELSE 'FAIL: Indexes missing'
END as index_validation;

-- 步骤 6: 提交事务
COMMIT;

-- 步骤 7: 清理临时表
DROP TABLE IF EXISTS _migration_backup;
