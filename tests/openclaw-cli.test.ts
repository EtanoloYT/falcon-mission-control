import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAgentRunArgs,
  parseOpenclawAgentOutput,
  parseOpenclawAgentsListOutput,
} from "../src/lib/openclaw-cli";
import { parseFlattenedDelegations, parseProposedSubtasks } from "../src/lib/dispatch";

test("builds agent run args the installed OpenClaw CLI actually accepts", () => {
  const args = buildAgentRunArgs({
    agentId: "falcon-hawk",
    sessionKey: "agent:falcon-hawk:mc-task-42",
    message: "do the thing",
    thinking: "low",
    timeoutSeconds: 900,
  });

  assert.deepEqual(args, [
    "agent",
    "--agent",
    "falcon-hawk",
    "--session-key",
    "agent:falcon-hawk:mc-task-42",
    "--message",
    "do the thing",
    "--thinking",
    "low",
    "--timeout",
    "900",
    "--json",
  ]);

  // OpenClaw 2026.7 supports explicit session keys. Every Mission Control task
  // uses one so unrelated task history cannot overflow the model context.
  assert.ok(args.includes("--session-key"));
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

test("parses an agent list after bracketed OpenClaw diagnostics", () => {
  const output = [
    "[agents/auth-profiles] synced openai-codex credentials from external cli",
    JSON.stringify([{ id: "mc-eagle", name: "Eagle" }], null, 2),
    "[agents/auth-profiles] another harmless diagnostic",
  ].join("\n");

  assert.deepEqual(parseOpenclawAgentsListOutput(output), [{ id: "mc-eagle", name: "Eagle" }]);
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

test("recovers and deduplicates flattened local-model delegation calls", () => {
  const token = "mct_49.7.123.signature";
  const flattened = [
    `falconmc__${token}`,
    "8",
    '"Build the notes app"',
    '"Implement CRUD behavior."',
    "high",
    `falconmc__${token}`,
    "11",
    '"Review the notes app"',
    '"Test the finished behavior."',
    "normal",
    // Models sometimes repeat their attempted call transcript verbatim.
    `falconmc__${token}`,
    "8",
    '"Build the notes app"',
    '"Implement CRUD behavior."',
    "high",
  ].join("\n");

  assert.deepEqual(parseFlattenedDelegations(flattened, token), [
    {
      title: "Build the notes app",
      description: "Implement CRUD behavior.",
      priority: "high",
      assigned_agent_id: 8,
    },
    {
      title: "Review the notes app",
      description: "Test the finished behavior.",
      priority: "normal",
      assigned_agent_id: 11,
    },
  ]);
  assert.deepEqual(parseFlattenedDelegations(flattened, "mct_wrong_task.7.123.signature"), []);
});
