# falcon-mission-control

Local-first single-user mission control for OpenClaw Gateway.

## Setup
1. Copy `.env.local` and set `MC_PORT=3030`, `OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789`, `OPENCLAW_GATEWAY_TOKEN=...`, `MC_API_KEY=...`, `DATABASE_PATH=./data/mc.db`.
2. Install deps: `pnpm install`.
3. Run dev: `pnpm dev`.
4. Build/start: `pnpm build && pnpm start`.
5. Optional seed: `pnpm seed`.

## Agent API Quickstart
```bash
# Agent creates a subtask
curl -X POST $MC_URL/api/tasks \
  -H "Authorization: Bearer $AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"project_id":1,"title":"Write unit tests for auth","priority":"normal","parent_task_id":42}'

# Agent reports completion
curl -X POST $MC_URL/api/tasks/43/complete \
  -H "Authorization: Bearer $AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"result":"Added 12 tests, all passing. See commit abc123."}'

# Agent heartbeats (every 30s)
curl -X POST $MC_URL/api/agents/7/heartbeat \
  -H "Authorization: Bearer $AGENT_KEY"
```
