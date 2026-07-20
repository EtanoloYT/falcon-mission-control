import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("per-task capability tokens", async (suite) => {
  // Both must be set before anything imports the db module: the token
  // signature is keyed on MC_API_KEY, and the store opens DATABASE_PATH on
  // first use. Dynamic imports keep that ordering explicit without relying on
  // top-level await, which this project's CJS test transform does not support.
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "falcon-task-token-"));
  process.env.DATABASE_PATH = path.join(scratchDir, "test.db");
  process.env.MC_API_KEY = "test-secret-not-a-real-key";

  try {
    const { issueTaskToken, verifyTaskToken } = await import("@/lib/task-token");
    const { createAgent, createProject, createTask, updateTask } = await import("@/lib/store");

    const { agent } = createAgent({ name: "Tokenbird", role: "coder" })!;
    const { agent: other } = createAgent({ name: "Otherbird", role: "reviewer" })!;
    const project = createProject({ name: "Token Project", description: "" })!;
    const task = createTask({
      project_id: project.id,
      title: "Do the thing",
      assigned_agent_id: agent.id,
    })!;

    await suite.test("accepts a freshly minted token and returns its claim", () => {
      const result = verifyTaskToken(issueTaskToken({ taskId: task.id, agentId: agent.id }));
      assert.equal(result.ok, true);
      assert.deepEqual(result.ok && result.claim, { taskId: task.id, agentId: agent.id });
    });

    await suite.test("rejects a token whose signature has been altered", () => {
      const token = issueTaskToken({ taskId: task.id, agentId: agent.id });
      const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
      const result = verifyTaskToken(tampered);
      assert.equal(result.ok, false);
      assert.match(result.ok === false ? result.error : "", /signature/i);
    });

    await suite.test("rejects a claimed agent swapped without resigning", () => {
      const token = issueTaskToken({ taskId: task.id, agentId: agent.id });
      const forged = token.replace(`mct_${task.id}.${agent.id}.`, `mct_${task.id}.${other.id}.`);
      assert.notEqual(forged, token);
      assert.equal(verifyTaskToken(forged).ok, false);
    });

    await suite.test("rejects an expired token", () => {
      const issuedLongAgo = issueTaskToken(
        { taskId: task.id, agentId: agent.id },
        Date.now() - 7 * 60 * 60 * 1000
      );
      const result = verifyTaskToken(issuedLongAgo);
      assert.equal(result.ok, false);
      assert.match(result.ok === false ? result.error : "", /expired/i);
    });

    await suite.test("revokes a token immediately when its task is reassigned", () => {
      const token = issueTaskToken({ taskId: task.id, agentId: agent.id });
      assert.equal(verifyTaskToken(token).ok, true);

      updateTask(task.id, { assigned_agent_id: other.id });
      const result = verifyTaskToken(token);
      assert.equal(result.ok, false);
      assert.match(result.ok === false ? result.error : "", /no longer assigned/i);

      updateTask(task.id, { assigned_agent_id: agent.id });
    });

    await suite.test("rejects missing and malformed tokens", () => {
      for (const bad of [null, undefined, "", "not-a-token", "mct_1.2", "mct_a.b.c.d"]) {
        assert.equal(verifyTaskToken(bad as string).ok, false, `expected rejection for ${String(bad)}`);
      }
    });
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
});
