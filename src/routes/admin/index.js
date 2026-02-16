import express from "express";
import { createAntigravityAdminRouter } from "./antigravity.js";
import { createKiroAccountsAdminRouter } from "./kiro-accounts.js";
import { createLogsAdminRouter } from "./logs.js";
import { createSettingsAdminRouter } from "./settings.js";
import { createStatsAdminRouter } from "./stats.js";
import { createSubscriptionsAdminRouter } from "./subscriptions.js";
import { createUserAdminRouter } from "./users.js";

/**
 * Admin Router Aggregator
 * Composes all admin sub-routers into a single router
 */
export function createAdminRouter(db, billing, subscription, accountPool) {
	const router = express.Router();

	// Mount all sub-routers
	// All sub-routers are mounted at '/' because they define their own path prefixes
	router.use("/", createUserAdminRouter(db, billing));
	router.use("/", createStatsAdminRouter(db));
	router.use("/", createLogsAdminRouter(db));
	router.use("/", createSettingsAdminRouter(db));
	router.use("/", createKiroAccountsAdminRouter(db, accountPool));
	router.use("/", createAntigravityAdminRouter(db));
	router.use("/", createSubscriptionsAdminRouter(db, subscription));

	return router;
}
