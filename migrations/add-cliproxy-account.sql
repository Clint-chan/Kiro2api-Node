INSERT OR IGNORE INTO kiro_accounts (
  id, 
  name, 
  refresh_token,
  auth_method,
  status,
  request_count,
  error_count,
  created_at
) VALUES (
  'cliproxy',
  'CLIProxy System',
  'system',
  'social',
  'active',
  0,
  0,
  datetime('now')
);
