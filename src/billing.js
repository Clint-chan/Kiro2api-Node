import { getModelPricing } from "./model-pricing.js";

// Constants
const DEFAULT_MAX_OUTPUT_TOKENS = 32000;

/**
 * BillingManager - Handles billing calculations and balance management
 */
export class BillingManager {
	constructor(database) {
		this.db = database;
	}

	/**
	 * Calculate cost based on token usage and prices
	 * @param {number} inputTokens - Number of input tokens
	 * @param {number} outputTokens - Number of output tokens
	 * @param {number} priceInput - Price per million input tokens ($/MTok)
	 * @param {number} priceOutput - Price per million output tokens ($/MTok)
	 * @returns {object} Cost breakdown
	 */
	calculateCost(inputTokens, outputTokens, priceInput, priceOutput) {
		const inputCost = (inputTokens / 1000000) * priceInput;
		const outputCost = (outputTokens / 1000000) * priceOutput;
		const totalCost = inputCost + outputCost;

		return {
			inputCost: parseFloat(inputCost.toFixed(6)),
			outputCost: parseFloat(outputCost.toFixed(6)),
			totalCost: parseFloat(totalCost.toFixed(6)),
		};
	}

	/**
	 * Calculate cost based on model pricing
	 * @param {number} inputTokens - Number of input tokens
	 * @param {number} outputTokens - Number of output tokens
	 * @param {string} model - Model identifier
	 * @returns {object} Cost breakdown
	 */
	calculateCostByModel(inputTokens, outputTokens, model) {
		const pricing = getModelPricing(model);
		return this.calculateCost(
			inputTokens,
			outputTokens,
			pricing.input,
			pricing.output,
		);
	}

	/**
	 * Check if user has sufficient balance for estimated request
	 * @param {object} user - User object
	 * @param {number} estimatedInputTokens - Estimated input tokens
	 * @param {number} maxOutputTokens - Maximum possible output tokens (default 32K)
	 * @param {string} model - Model identifier (optional, uses model pricing if provided)
	 * @returns {object} Balance check result
	 */
	checkBalance(
		user,
		estimatedInputTokens,
		maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
		model = null,
	) {
		// Calculate maximum possible cost
		let maxCost;
		if (model) {
			maxCost = this.calculateCostByModel(
				estimatedInputTokens,
				maxOutputTokens,
				model,
			);
		} else {
			maxCost = this.calculateCost(
				estimatedInputTokens,
				maxOutputTokens,
				user.price_input,
				user.price_output,
			);
		}

		const sufficient = user.balance >= maxCost.totalCost;

		return {
			sufficient,
			currentBalance: user.balance,
			estimatedMaxCost: maxCost.totalCost,
			remainingBalance: user.balance - maxCost.totalCost,
		};
	}

	/**
	 * Record request and charge user (transaction)
	 * @param {object} logData - Request log data (must include model field)
	 * @returns {object} Result with updated balance
	 */
	recordRequestAndCharge(logData) {
		return this.db.transaction(() => {
			// Get current user
			const user = this.db.getUserById(logData.user_id);
			if (!user) {
				throw new Error("User not found");
			}

			// Calculate actual cost using model pricing
			const cost = this.calculateCostByModel(
				logData.input_tokens,
				logData.output_tokens,
				logData.model,
			);

			// Check if balance is sufficient
			if (user.balance < cost.totalCost) {
				throw new Error("Insufficient balance");
			}

			// Deduct balance
			const newBalance = user.balance - cost.totalCost;
			this.db.updateUserBalance(user.id, newBalance);

			// Update user statistics
			this.db.updateUserStats(
				user.id,
				logData.input_tokens,
				logData.output_tokens,
				cost.totalCost,
			);

			// Update period_used for subscription users
			if (user.subscription_type && user.subscription_type !== "none") {
				const newPeriodUsed = (user.period_used || 0) + cost.totalCost;
				this.db.updatePeriodUsed(user.id, newPeriodUsed);
			}

			// Insert request log
			const logDataWithCost = {
				...logData,
				input_cost: cost.inputCost,
				output_cost: cost.outputCost,
				total_cost: cost.totalCost,
			};
			this.db.insertRequestLog(logDataWithCost);

			// Update Kiro account stats
			if (logData.success) {
				this.db.updateKiroAccountStats(logData.kiro_account_id);
			} else {
				this.db.updateKiroAccountError(logData.kiro_account_id);
			}

			return {
				success: true,
				cost: cost.totalCost,
				newBalance,
				previousBalance: user.balance,
			};
		});
	}

	/**
	 * Recharge user balance
	 * @param {string} userId - User ID
	 * @param {number} amount - Amount to add
	 * @param {string} operatorId - Operator user ID (admin)
	 * @param {string} notes - Optional notes
	 * @returns {object} Result with new balance
	 */
	recharge(userId, amount, operatorId = null, notes = null) {
		const numericAmount = Number(amount);
		if (!Number.isFinite(numericAmount) || numericAmount === 0) {
			throw new Error("Adjustment amount must be a non-zero number");
		}

		// Get current user
		const user = this.db.getUserById(userId);
		if (!user) {
			throw new Error("User not found");
		}

		const balanceBefore = user.balance;
		const balanceAfter = balanceBefore + numericAmount;

		if (balanceAfter < 0) {
			throw new Error("Adjustment would make balance negative");
		}

		// Use transaction
		return this.db.transaction(() => {
			// Update balance
			this.db.updateUserBalance(userId, balanceAfter);

			// Insert recharge record
			this.db.insertRechargeRecord({
				user_id: userId,
				amount: numericAmount,
				balance_before: balanceBefore,
				balance_after: balanceAfter,
				operator_id: operatorId,
				notes,
			});

			return {
				success: true,
				amount: numericAmount,
				balanceBefore,
				balanceAfter,
			};
		});
	}

	/**
	 * Generate bill for user
	 * @param {string} userId - User ID
	 * @param {string} startDate - Start date (ISO string)
	 * @param {string} endDate - End date (ISO string)
	 * @returns {object} Bill details
	 */
	generateBill(userId, startDate, endDate) {
		const user = this.db.getUserById(userId);
		if (!user) {
			throw new Error("User not found");
		}

		// Get statistics for period
		const stats = this.db.getUserStats(userId, startDate, endDate);
		const modelStats = this.db.getModelStats(userId, startDate, endDate);
		const dailyStats = this.db.getDailyStats(userId, startDate, endDate);
		const recharges = this.db.getRechargeRecords(userId, 1000, 0);

		// Filter recharges by date range
		const periodRecharges = recharges.filter((r) => {
			return r.created_at >= startDate && r.created_at <= endDate;
		});

		const totalRecharged = periodRecharges.reduce(
			(sum, r) => sum + r.amount,
			0,
		);

		return {
			user: {
				id: user.id,
				username: user.username,
				api_key: user.api_key,
			},
			period: {
				start: startDate,
				end: endDate,
			},
			summary: {
				totalRequests: stats.total_requests || 0,
				successfulRequests: stats.successful_requests || 0,
				failedRequests: stats.failed_requests || 0,
				totalInputTokens: stats.total_input_tokens || 0,
				totalOutputTokens: stats.total_output_tokens || 0,
				totalCost: stats.total_cost || 0,
				totalRecharged,
				netCost: (stats.total_cost || 0) - totalRecharged,
			},
			modelBreakdown: modelStats,
			dailyBreakdown: dailyStats,
			recharges: periodRecharges,
			currentBalance: user.balance,
			priceConfig: {
				inputPrice: user.price_input,
				outputPrice: user.price_output,
			},
		};
	}

	/**
	 * Get user balance and statistics
	 * @param {string} userId - User ID
	 * @returns {object} Balance and stats
	 */
	getUserBalanceInfo(userId) {
		const user = this.db.getUserById(userId);
		if (!user) {
			throw new Error("User not found");
		}

		return {
			balance: user.balance,
			totalRequests: user.total_requests,
			totalInputTokens: user.total_input_tokens,
			totalOutputTokens: user.total_output_tokens,
			totalCost: user.total_cost,
			priceInput: user.price_input,
			priceOutput: user.price_output,
			status: user.status,
			lastUsedAt: user.last_used_at,
		};
	}

	/**
	 * Estimate cost for a request
	 * @param {number} inputTokens - Input tokens
	 * @param {number} outputTokens - Output tokens
	 * @param {string} model - Model identifier (uses model pricing)
	 * @returns {object} Cost estimate
	 */
	estimateCost(inputTokens, outputTokens, model) {
		return this.calculateCostByModel(inputTokens, outputTokens, model);
	}
}
