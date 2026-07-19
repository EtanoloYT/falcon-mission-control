import test from "node:test";
import assert from "node:assert/strict";

const baseUrl = process.env.MC_URL ?? "http://localhost:3030";

async function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  if (process.env.MC_API_KEY && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${process.env.MC_API_KEY}`);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });

  const payload = (await response.json()) as { ok: boolean; data?: unknown; error?: string };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? `Request failed ${response.status}`);
  }

  return payload.data as any;
}

test("happy path: project -> agents -> task lifecycle", async () => {
  const project = await request("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      name: `test-project-${Date.now()}`,
      description: "Happy path project",
    }),
  });

  const ceoCreated = await request("/api/agents", {
    method: "POST",
    body: JSON.stringify({
      name: `ceo-${Date.now()}`,
      role: "ceo",
      soul: "CEO soul",
    }),
  });

  const coderCreated = await request("/api/agents", {
    method: "POST",
    body: JSON.stringify({
      name: `coder-${Date.now()}`,
      role: "coder",
      parent_id: ceoCreated.agent.id,
      soul: "Coder soul",
    }),
  });

  const task = await request("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      project_id: project.id,
      title: "Implement feature",
      description: "Do the thing",
      assigned_agent_id: coderCreated.agent.id,
    }),
  });

  await request(`/api/tasks/${task.id}/claim`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${coderCreated.agentKey}`,
    },
    body: JSON.stringify({}),
  });

  await request(`/api/tasks/${task.id}/complete`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${coderCreated.agentKey}`,
    },
    body: JSON.stringify({ result: "Completed in test" }),
  });

  const updated = await request(`/api/tasks/${task.id}`);
  assert.ok(["done", "review"].includes(updated.status));
});
