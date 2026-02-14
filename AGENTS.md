# Project Engineering Rules

- `reference_project/` is for technical reference only.
- Do not copy files directly from `reference_project/` into this project.
- Implement changes using this repository's existing architecture and coding patterns.

## Service Management

### Restart PM2 Service (Required after code changes)

To properly restart the service and see code modifications take effect:

```bash
cd /mnt/c/Users/94503/Documents/Kiro2api-Node && cmd.exe /c "stop-pm2.bat && start-pm2.bat" && sleep 8 && curl -s http://localhost:19864/health | jq .status
```

**Important**: 
- Always use this command after modifying code
- Wait for health check to return "healthy" before testing
- Simple `pm2 restart` may not reload code changes properly
