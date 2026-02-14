# Project Engineering Rules

- `reference_project/` is for technical reference only.
- Do not copy files directly from `reference_project/` into this project.
- Implement changes using this repository's existing architecture and coding patterns.

## Context Retrieval Priority (Highest)

- For any task that needs repository context, you MUST use `ace-tool_search_context` first.
- Treat `ace-tool_search_context` as the default starting point for codebase exploration.
- Only use `grep`, `glob`, and direct `read` after `ace-tool_search_context` has been used, for targeted follow-up.
- If context is unclear, run another `ace-tool_search_context` query before trying alternative search methods.

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
