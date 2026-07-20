import test from "node:test";
import assert from "node:assert/strict";

import { buildAgentRunArgs, parseOpenclawAgentOutput } from "../src/lib/openclaw-cli";
import { parseProposedSubtasks } from "../src/lib/dispatch";

test("builds agent run args the installed OpenClaw CLI actually accepts", () => {
  const args = buildAgentRunArgs({
    agentId: "falcon-hawk",
    message: "do the thing",
    thinking: "low",
    timeoutSeconds: 900,
  });

  assert.deepEqual(args, [
    "agent",
    "--agent",
    "falcon-hawk",
    "--message",
    "do the thing",
    "--thinking",
    "low",
    "--timeout",
    "900",
    "--json",
  ]);

  // Regression: these flags do not exist in OpenClaw 2026.4.15. Passing them
  // made every dispatch exit non-zero and mark the task failed.
  assert.ok(!args.includes("--session-key"));
  assert.ok(!args.includes("--message-file"));
});

test("parses the visible payload from a successful OpenClaw agent run", () => {
  const result = parseOpenclawAgentOutput(
    JSON.stringify({
      runId: "run-1",
      status: "ok",
      result: {
        payloads: [{ text: "Task completed" }],
        meta: {
          durationMs: 123,
          agentMeta: { sessionId: "session-1", provider: "ollama", model: "gpt-oss:20b" },
        },
      },
    })
  );

  assert.deepEqual(result, {
    runId: "run-1",
    text: "Task completed",
    durationMs: 123,
    sessionId: "session-1",
    provider: "ollama",
    model: "gpt-oss:20b",
  });
});

test("uses final assistant text when payloads are absent", () => {
  // OpenClaw nests finalAssistant* under result.meta, not result.
  const result = parseOpenclawAgentOutput(
    `OpenClaw diagnostic line\n${JSON.stringify({
      status: "ok",
      result: { meta: { finalAssistantVisibleText: "Ready" } },
    })}`
  );

  assert.equal(result.text, "Ready");
});

test("rejects unsuccessful OpenClaw runs", () => {
  assert.throws(
    () => parseOpenclawAgentOutput(JSON.stringify({ status: "error", error: "model unavailable" })),
    /model unavailable/
  );
});

test("extracts validated Mission Control subtasks and removes the control block", () => {
  const parsed = parseProposedSubtasks(`Work breakdown ready.\n<mission_control_subtasks>
[{"title":"Implement API","description":"Build it","priority":"high","assigned_agent_id":3}]
</mission_control_subtasks>`);

  assert.equal(parsed.cleanText, "Work breakdown ready.");
  assert.deepEqual(parsed.subtasks, [
    { title: "Implement API", description: "Build it", priority: "high", assigned_agent_id: 3 },
  ]);
});

test("drops invalid Mission Control subtask entries", () => {
  const parsed = parseProposedSubtasks(
    '<mission_control_subtasks>[{"title":"","priority":"urgent","assigned_agent_id":3},{"title":"Bad","priority":"extreme","assigned_agent_id":3}]</mission_control_subtasks>'
  );

  assert.deepEqual(parsed.subtasks, []);
});
