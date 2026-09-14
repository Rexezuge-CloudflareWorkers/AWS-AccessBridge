-- Migration 0030: Squash of migrations 0001–0029
-- Complete schema for a fresh database installation.
-- Existing deployed databases are unaffected and this file is idempotent
-- (all statements use IF NOT EXISTS / INSERT OR IGNORE).

-- ============================================================
-- Tables (creation order respects foreign-key dependencies)
-- ============================================================

CREATE TABLE IF NOT EXISTS credentials (
    principal_arn VARCHAR(256) PRIMARY KEY,
    assumed_by VARCHAR(256),
    encrypted_access_key_id VARCHAR(128),
    encrypted_secret_access_key VARCHAR(256),
    encrypted_session_token VARCHAR(2048),
    salt VARCHAR(128)
);

CREATE TABLE IF NOT EXISTS aws_accounts (
    aws_account_id CHAR(12) PRIMARY KEY,
    aws_account_nickname VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS user_metadata (
    user_email VARCHAR(120) PRIMARY KEY,
    is_superadmin BOOLEAN DEFAULT FALSE,
    federation_username CHAR(32),
    preferred_language TEXT
);

CREATE TABLE IF NOT EXISTS teams (
    team_id VARCHAR(36) PRIMARY KEY,
    team_name VARCHAR(128) NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    created_by VARCHAR(120) NOT NULL
);

CREATE TABLE IF NOT EXISTS assumable_roles (
    user_email VARCHAR(120),
    aws_account_id CHAR(12),
    role_name VARCHAR(128),
    hidden BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (user_email, aws_account_id, role_name),
    FOREIGN KEY (user_email) REFERENCES user_metadata(user_email),
    FOREIGN KEY (aws_account_id) REFERENCES aws_accounts(aws_account_id)
);

CREATE TABLE IF NOT EXISTS user_favorite_accounts (
    user_email VARCHAR(120),
    aws_account_id CHAR(12),
    PRIMARY KEY (user_email, aws_account_id),
    FOREIGN KEY (user_email) REFERENCES user_metadata(user_email),
    FOREIGN KEY (aws_account_id) REFERENCES aws_accounts(aws_account_id)
);

CREATE TABLE IF NOT EXISTS role_configs (
    aws_account_id CHAR(12),
    role_name VARCHAR(128),
    destination_region VARCHAR(32),
    destination_path VARCHAR(128),
    role_session_duration_seconds INTEGER,
    PRIMARY KEY (aws_account_id, role_name),
    FOREIGN KEY (aws_account_id) REFERENCES aws_accounts(aws_account_id)
);

CREATE TABLE IF NOT EXISTS user_access_tokens (
    token_id VARCHAR(64) PRIMARY KEY,
    user_email VARCHAR(120) NOT NULL,
    access_token VARCHAR(100) NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_used_at INTEGER,
    FOREIGN KEY (user_email) REFERENCES user_metadata(user_email) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS credential_cache_config (
    principal_arn VARCHAR(256) PRIMARY KEY,
    last_cached_at INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (principal_arn) REFERENCES credentials(principal_arn) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
    log_id VARCHAR(36) PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    user_email VARCHAR(120) NOT NULL,
    action VARCHAR(64) NOT NULL,
    resource VARCHAR(256),
    method VARCHAR(10) NOT NULL,
    path VARCHAR(512) NOT NULL,
    status_code INTEGER NOT NULL,
    detail TEXT,
    ip_address VARCHAR(45),
    user_agent VARCHAR(512)
);

CREATE TABLE IF NOT EXISTS cost_data (
    aws_account_id VARCHAR(12) NOT NULL,
    period_start VARCHAR(10) NOT NULL,
    period_end VARCHAR(10) NOT NULL,
    total_cost REAL NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    service_breakdown TEXT,
    collected_at INTEGER NOT NULL,
    PRIMARY KEY (aws_account_id, period_start)
);

CREATE TABLE IF NOT EXISTS data_collection_config (
    principal_arn VARCHAR(256) NOT NULL,
    collection_type VARCHAR(20) NOT NULL,
    last_collected_at INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (principal_arn, collection_type)
);

CREATE TABLE IF NOT EXISTS spend_alerts (
    alert_id VARCHAR(64) PRIMARY KEY,
    aws_account_id VARCHAR(12) NOT NULL,
    threshold_amount REAL NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    period_type VARCHAR(10) NOT NULL DEFAULT 'monthly',
    created_by VARCHAR(120) NOT NULL,
    created_at INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS resource_inventory (
    aws_account_id VARCHAR(12) NOT NULL,
    region VARCHAR(20) NOT NULL,
    resource_type VARCHAR(10) NOT NULL,
    resource_id VARCHAR(256) NOT NULL,
    resource_name VARCHAR(256),
    state VARCHAR(50),
    metadata TEXT,
    collected_at INTEGER NOT NULL,
    PRIMARY KEY (aws_account_id, resource_type, resource_id)
);

CREATE TABLE IF NOT EXISTS team_members (
    team_id VARCHAR(36) NOT NULL,
    user_email VARCHAR(120) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (team_id, user_email)
);

CREATE TABLE IF NOT EXISTS team_accounts (
    team_id VARCHAR(36) NOT NULL,
    aws_account_id CHAR(12) NOT NULL,
    PRIMARY KEY (team_id, aws_account_id)
);

CREATE TABLE IF NOT EXISTS background_task_runs (
    run_id TEXT PRIMARY KEY,
    task_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    items_processed INTEGER NOT NULL DEFAULT 0,
    items_failed INTEGER NOT NULL DEFAULT 0,
    summary TEXT,
    details TEXT,
    error_message TEXT,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    created_at INTEGER NOT NULL,
    CHECK (status IN ('running', 'success', 'partial_success', 'error', 'skipped'))
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_assumable_roles_user_email_account
    ON assumable_roles (user_email, aws_account_id);

CREATE INDEX IF NOT EXISTS idx_user_access_tokens_user_email ON user_access_tokens(user_email);
CREATE INDEX IF NOT EXISTS idx_user_access_tokens_expires_at ON user_access_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_credential_cache_last_cached_at ON credential_cache_config (last_cached_at ASC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_email ON audit_logs(user_email);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_email_timestamp ON audit_logs(user_email, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_cost_data_account_period ON cost_data(aws_account_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_cost_data_collected_at ON cost_data(collected_at);

CREATE INDEX IF NOT EXISTS idx_data_collection_config_type_last ON data_collection_config(collection_type, last_collected_at ASC);

CREATE INDEX IF NOT EXISTS idx_spend_alerts_account ON spend_alerts(aws_account_id);
CREATE INDEX IF NOT EXISTS idx_spend_alerts_created_by ON spend_alerts(created_by);

CREATE INDEX IF NOT EXISTS idx_resource_inventory_type ON resource_inventory(resource_type, aws_account_id);
CREATE INDEX IF NOT EXISTS idx_resource_inventory_collected_at ON resource_inventory(collected_at);
CREATE INDEX IF NOT EXISTS idx_resource_inventory_account ON resource_inventory(aws_account_id);

CREATE INDEX IF NOT EXISTS idx_team_members_user_email ON team_members(user_email);

CREATE INDEX IF NOT EXISTS idx_team_accounts_aws_account_id ON team_accounts(aws_account_id);

CREATE INDEX IF NOT EXISTS idx_btr_type_started
    ON background_task_runs (task_type, started_at DESC);

-- ============================================================
-- Seed data
-- ============================================================

-- Create default team
INSERT OR IGNORE INTO teams (team_id, team_name, created_at, created_by)
VALUES ('00000000-0000-0000-0000-000000000000', 'Default', strftime('%s', 'now'), 'system');

-- Add all existing users as members of the default team
INSERT OR IGNORE INTO team_members (team_id, user_email, role, joined_at)
SELECT '00000000-0000-0000-0000-000000000000', user_email,
       CASE WHEN is_superadmin = 1 THEN 'admin' ELSE 'member' END,
       strftime('%s', 'now')
FROM user_metadata;

-- Associate all existing AWS accounts with the default team
INSERT OR IGNORE INTO team_accounts (team_id, aws_account_id)
SELECT '00000000-0000-0000-0000-000000000000', aws_account_id
FROM aws_accounts;
