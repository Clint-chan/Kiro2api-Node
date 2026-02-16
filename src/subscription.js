/**
 * 订阅管理模块
 * 处理用户订阅、自动重置额度等功能
 */

import { logger } from "./logger.js";

export class SubscriptionManager {
	constructor(db) {
		this.db = db;
	}

	/**
	 * 为用户设置订阅
	 * @param {string} userId - 用户ID
	 * @param {string} type - 订阅类型: 'daily' | 'monthly'
	 * @param {number} quota - 每周期额度
	 * @param {number} durationMonths - 订阅月数
	 * @param {number} amountPaid - 支付金额
	 * @param {string} operatorId - 操作员ID
	 * @param {string} notes - 备注
	 */
	setSubscription(
		userId,
		type,
		quota,
		durationMonths,
		amountPaid = 0,
		operatorId = null,
		notes = null,
	) {
		const user = this.db.getUserById(userId);
		if (!user) {
			throw new Error("用户不存在");
		}

		if (!["daily", "monthly"].includes(type)) {
			throw new Error("订阅类型必须是 daily 或 monthly");
		}

		if (quota <= 0) {
			throw new Error("订阅额度必须大于 0");
		}

		if (!durationMonths || durationMonths <= 0) {
			throw new Error("订阅时长必须大于 0");
		}

		const now = new Date();
		const hadActiveSubscription =
			user.subscription_type && user.subscription_type !== "none";
		const previousQuota = hadActiveSubscription
			? user.subscription_quota || 0
			: 0;

		// 使用自然月计算到期日期
		const expiresAt = new Date(now);
		expiresAt.setMonth(expiresAt.getMonth() + durationMonths);

		// 更新用户订阅信息
		this.db.db
			.prepare(`
      UPDATE users 
      SET subscription_type = ?,
          subscription_quota = ?,
          subscription_expires_at = ?,
          last_reset_at = ?,
          period_used = 0,
          updated_at = ?
      WHERE id = ?
    `)
			.run(
				type,
				quota,
				expiresAt.toISOString(),
				now.toISOString(),
				now.toISOString(),
				userId,
			);

		const balanceBefore = user.balance;
		const adjustedBalanceBase = hadActiveSubscription
			? Math.max(0, balanceBefore - previousQuota)
			: balanceBefore;
		const balanceAfter = adjustedBalanceBase + quota;

		this.db.db
			.prepare(`
      UPDATE users SET balance = ? WHERE id = ?
    `)
			.run(balanceAfter, userId);

		// 记录订阅历史
		this.db.db
			.prepare(`
      INSERT INTO subscription_history (
        user_id, subscription_type, quota, duration_days, amount_paid,
        started_at, expires_at, operator_id, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
			.run(
				userId,
				type,
				quota,
				durationMonths, // 存储月数
				amountPaid,
				now.toISOString(),
				expiresAt.toISOString(),
				operatorId,
				notes,
				now.toISOString(),
			);

		// 记录首次充值
		this.db.db
			.prepare(`
      INSERT INTO quota_reset_logs (
        user_id, subscription_type, quota_amount, reset_type,
        balance_before, balance_after, reset_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
			.run(
				userId,
				type,
				quota,
				hadActiveSubscription ? "subscription_change" : "initial",
				balanceBefore,
				balanceAfter,
				now.toISOString(),
			);

		return {
			userId,
			subscription_type: type,
			subscription_quota: quota,
			subscription_expires_at: expiresAt.toISOString(),
			next_reset: this.getNextResetTime({
				subscription_type: type,
				last_reset_at: now.toISOString(),
			}),
			balanceBefore,
			balanceAfter,
		};
	}

	/**
	 * 取消用户订阅
	 */
	cancelSubscription(userId) {
		const user = this.db.getUserById(userId);
		if (!user) {
			throw new Error("用户不存在");
		}

		this.db.db
			.prepare(`
      UPDATE users 
      SET subscription_type = 'none',
          subscription_quota = 0,
          subscription_expires_at = NULL,
          period_used = 0,
          updated_at = ?
      WHERE id = ?
    `)
			.run(new Date().toISOString(), userId);

		return { success: true };
	}

	/**
	 * 续费订阅
	 */
	renewSubscription(
		userId,
		durationMonths,
		amountPaid = 0,
		operatorId = null,
		notes = null,
	) {
		const user = this.db.getUserById(userId);
		if (!user) {
			throw new Error("用户不存在");
		}

		if (user.subscription_type === "none") {
			throw new Error("用户没有活跃的订阅");
		}

		const now = new Date();
		const currentExpires = user.subscription_expires_at
			? new Date(user.subscription_expires_at)
			: now;
		// 使用自然月计算
		const newExpires = new Date(
			Math.max(currentExpires.getTime(), now.getTime()),
		);
		newExpires.setMonth(newExpires.getMonth() + durationMonths);

		// 更新到期时间
		this.db.db
			.prepare(`
      UPDATE users 
      SET subscription_expires_at = ?,
          updated_at = ?
      WHERE id = ?
    `)
			.run(newExpires.toISOString(), now.toISOString(), userId);

		// 记录续费历史
		this.db.db
			.prepare(`
      INSERT INTO subscription_history (
        user_id, subscription_type, quota, duration_days, amount_paid,
        started_at, expires_at, operator_id, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
			.run(
				userId,
				user.subscription_type,
				user.subscription_quota,
				durationMonths, // 存储月数
				amountPaid,
				now.toISOString(),
				newExpires.toISOString(),
				operatorId,
				notes || "续费",
				now.toISOString(),
			);

		return {
			userId,
			expiresAt: newExpires.toISOString(),
		};
	}

	/**
	 * 检查并重置需要重置的用户额度
	 * 应该由定时任务调用
	 */
	checkAndResetQuotas() {
		const now = new Date();
		const results = [];

		// 获取所有有订阅的用户
		const users = this.db.db
			.prepare(`
      SELECT * FROM users 
      WHERE subscription_type IN ('daily', 'monthly')
        AND subscription_expires_at > ?
        AND status = 'active'
    `)
			.all(now.toISOString());

		for (const user of users) {
			try {
				const shouldReset = this.shouldResetQuota(user, now);

				if (shouldReset) {
					const result = this.resetUserQuota(user, now);
					results.push({ userId: user.id, username: user.username, ...result });
				}
			} catch (error) {
				logger.error("重置用户额度失败", { userId: user.id, error });
				results.push({
					userId: user.id,
					username: user.username,
					error: error.message,
				});
			}
		}

		return results;
	}

	/**
	 * 判断是否应该重置额度
	 */
	shouldResetQuota(user, now) {
		if (!user.last_reset_at) {
			return true; // 从未重置过
		}

		const lastReset = new Date(user.last_reset_at);
		const hoursSinceReset =
			(now.getTime() - lastReset.getTime()) / (1000 * 60 * 60);

		if (user.subscription_type === "daily") {
			// 每日套餐：超过24小时就重置
			return hoursSinceReset >= 24;
		} else if (user.subscription_type === "monthly") {
			// 每月套餐：检查是否跨月
			return (
				lastReset.getMonth() !== now.getMonth() ||
				lastReset.getFullYear() !== now.getFullYear()
			);
		}

		return false;
	}

	/**
	 * 重置用户额度
	 */
	resetUserQuota(user, now) {
		const balanceBefore = user.balance;
		const balanceAfter = balanceBefore + user.subscription_quota;

		// 更新余额和重置时间
		this.db.db
			.prepare(`
      UPDATE users 
      SET balance = ?,
          last_reset_at = ?,
          period_used = 0,
          updated_at = ?
      WHERE id = ?
    `)
			.run(balanceAfter, now.toISOString(), now.toISOString(), user.id);

		// 记录重置日志
		this.db.db
			.prepare(`
      INSERT INTO quota_reset_logs (
        user_id, subscription_type, quota_amount, reset_type,
        balance_before, balance_after, reset_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
			.run(
				user.id,
				user.subscription_type,
				user.subscription_quota,
				"scheduled",
				balanceBefore,
				balanceAfter,
				now.toISOString(),
			);

		return {
			success: true,
			quota: user.subscription_quota,
			balanceBefore,
			balanceAfter,
			resetAt: now.toISOString(),
		};
	}

	/**
	 * 检查并处理过期订阅
	 */
	checkExpiredSubscriptions() {
		const now = new Date();
		const results = [];

		const expiredUsers = this.db.db
			.prepare(`
      SELECT id, username, subscription_type, subscription_expires_at
      FROM users 
      WHERE subscription_type IN ('daily', 'monthly')
        AND subscription_expires_at <= ?
        AND status = 'active'
    `)
			.all(now.toISOString());

		for (const user of expiredUsers) {
			try {
				this.cancelSubscription(user.id);
				results.push({
					userId: user.id,
					username: user.username,
					expired: true,
					expiresAt: user.subscription_expires_at,
				});
			} catch (error) {
				logger.error("处理过期订阅失败", { userId: user.id, error });
			}
		}

		return results;
	}

	/**
	 * 获取用户订阅信息
	 */
	getUserSubscription(userId) {
		const user = this.db.getUserById(userId);
		if (!user) {
			throw new Error("用户不存在");
		}

		return {
			type: user.subscription_type,
			quota: user.subscription_quota,
			expiresAt: user.subscription_expires_at,
			lastResetAt: user.last_reset_at,
			periodUsed: user.period_used,
			isActive:
				user.subscription_type !== "none" &&
				user.subscription_expires_at &&
				new Date(user.subscription_expires_at) > new Date(),
		};
	}

	/**
	 * 获取用户订阅历史
	 */
	getUserSubscriptionHistory(userId, limit = 50) {
		return this.db.db
			.prepare(`
      SELECT * FROM subscription_history
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
			.all(userId, limit);
	}

	/**
	 * 获取用户重置日志
	 */
	getUserResetLogs(userId, limit = 50) {
		return this.db.db
			.prepare(`
      SELECT * FROM quota_reset_logs
      WHERE user_id = ?
      ORDER BY reset_at DESC
      LIMIT ?
    `)
			.all(userId, limit);
	}

	/**
	 * 获取下次重置时间
	 */
	getNextResetTime(user) {
		if (!user || !user.subscription_type || user.subscription_type === "none") {
			return null;
		}

		if (!user.last_reset_at) {
			return new Date().toISOString(); // 立即重置
		}

		const lastReset = new Date(user.last_reset_at);

		if (user.subscription_type === "daily") {
			// 每日套餐：上次重置 + 24小时
			const nextReset = new Date(lastReset.getTime() + 24 * 60 * 60 * 1000);
			return nextReset.toISOString();
		} else if (user.subscription_type === "monthly") {
			// 每月套餐：下个月的同一天
			const nextReset = new Date(lastReset);
			nextReset.setMonth(nextReset.getMonth() + 1);
			return nextReset.toISOString();
		}

		return null;
	}
}
