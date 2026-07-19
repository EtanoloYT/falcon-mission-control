# falcon-mission-control

Local-first single-user mission control for OpenClaw Gateway.

## Setup
1. Copy `.env.local` and set `MC_PORT=3030`, `OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789`, `OPENCLAW_GATEWAY_TOKEN=...`, `MC_API_KEY=...`, `DATABASE_PATH=./data/mc.db`.
2. Install deps: `pnpm install`.
3. Run dev: `pnpm dev`.
4. Build/start: `pnpm build && pnpm start`.
5. Optional seed: `pnpm seed`.

## Automatic OpenClaw dispatch

- Creating a task with an assignee immediately queues a real OpenClaw agent turn.
- Creating an unassigned task automatically routes it to the CEO/orchestrator.
- Assigning a backlog task or clicking **Wake** also starts the agent; Wake picks the agent's highest-priority pending task first.
- Mission Control records `busy`/`idle`/`error`, `last_seen`, task progress, the final agent response, and dispatch failures automatically. Agents do not need a Mission Control API key in their prompt.
- Orchestrators return a validated machine-readable subtask block; Mission Control creates and queues those tasks itself, so no Mission Control or Gateway credentials are ever put in an agent prompt.
- Runs are serialized locally so a single-concurrency Ollama setup is not overloaded. Assigned work is recovered after Mission Control restarts.

Optional environment controls: `OPENCLAW_BIN=/absolute/path/to/openclaw` and `OPENCLAW_TASK_TIMEOUT_SECONDS=900`.

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
