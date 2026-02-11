-- Kiro2api-Node Database Schema
-- Multi-user SaaS Architecture

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    balance REAL NOT NULL DEFAULT 0.0,
    status TEXT NOT NULL DEFAULT 'active',

    -- Price configuration (per user)
    price_input REAL NOT NULL DEFAULT 3.0,
    price_output REAL NOT NULL DEFAULT 15.0,

    -- Statistics
    total_requests INTEGER DEFAULT 0,
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    total_cost REAL DEFAULT 0.0,

    -- Timestamps
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_used_at TEXT,
    notes TEXT,

    CHECK (role IN ('user', 'admin')),
    CHECK (status IN ('active', 'suspended', 'deleted')),
    CHECK (balance >= 0),
    CHECK (price_input >= 0),
    CHECK (price_output >= 0)
);

CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- System settings table
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Kiro accounts table
CREATE TABLE IF NOT EXISTS kiro_accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,

    -- Credentials (encrypted storage)
    refresh_token TEXT NOT NULL,
    auth_method TEXT NOT NULL,
    client_id TEXT,
    client_secret TEXT,
    region TEXT,
    machine_id TEXT,
    profile_arn TEXT,

    -- Status and statistics
    status TEXT NOT NULL DEFAULT 'active',
    request_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,

    -- Quota information
    usage_limit REAL,
    current_usage REAL,
    available REAL,
    user_email TEXT,
    subscription_type TEXT,
    next_reset TEXT,
    usage_updated_at TEXT,

    created_at TEXT NOT NULL,
    last_used_at TEXT,

    CHECK (status IN ('active', 'inactive', 'error')),
    CHECK (auth_method IN ('social', 'idc', 'builder'))
);

CREATE INDEX IF NOT EXISTS idx_kiro_accounts_status ON kiro_accounts(status);
CREATE INDEX IF NOT EXISTS idx_kiro_accounts_user_email ON kiro_accounts(user_email);

-- Request logs table
CREATE TABLE IF NOT EXISTS request_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- User information
    user_id TEXT NOT NULL,
    user_api_key TEXT NOT NULL,

    -- Kiro account information
    kiro_account_id TEXT NOT NULL,
    kiro_account_name TEXT NOT NULL,

    -- Request information
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,

    -- Billing information
    input_cost REAL NOT NULL,
    output_cost REAL NOT NULL,
    total_cost REAL NOT NULL,

    -- Status
    success INTEGER NOT NULL,
    error_message TEXT,
    timestamp TEXT NOT NULL,

    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (kiro_account_id) REFERENCES kiro_accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_request_logs_user_id ON request_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_request_logs_kiro_account_id ON request_logs(kiro_account_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_model ON request_logs(model);
CREATE INDEX IF NOT EXISTS idx_request_logs_success ON request_logs(success);

-- Recharge records table
CREATE TABLE IF NOT EXISTS recharge_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    balance_before REAL NOT NULL,
    balance_after REAL NOT NULL,
    operator_id TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,

    FOREIGN KEY (user_id) REFERENCES users(id),
    CHECK (amount != 0)
);

CREATE INDEX IF NOT EXISTS idx_recharge_records_user_id ON recharge_records(user_id);
CREATE INDEX IF NOT EXISTS idx_recharge_records_created_at ON recharge_records(created_at);
