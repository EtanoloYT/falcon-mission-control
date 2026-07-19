import { NextRequest } from "next/server";

import { withAuth } from "@/lib/auth";
import { getDb, parseJson } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { openclawDispatchSchema } from "@/lib/schemas";
import { getAgent, getProject, getTask } from "@/lib/store";
import { invoke } from "@/lib/openclaw";

function buildPrompt(input: { projectName: string; projectDescription: string; taskId: number; title: string; description: string; priority: string; mcUrl: string }) {
  return [
    `Project: ${input.projectName}`,
    `Project description: ${input.projectDescription}`,
    `Task #${input.taskId}: ${input.title}`,
    `Description: ${input.description}`,
    `Priority: ${input.priority}`,
    "When done, report back with:",
    `  curl -X POST ${input.mcUrl}/api/tasks/${input.taskId}/complete -H "Authorization: Bearer $AGENT_KEY" -H "Content-Type: application/json" -d '{\"result\":\"...\"}'`,
  ].join("\n");
}

export const POST = withAuth(async (request: NextRequest, context) => {
  const body = openclawDispatchSchema.parse(await request.json());
  const agent = getAgent(body.agent_id);
  if (!agent) {
    return fail("Agent not found", 404);
  }

  const task = getTask(body.task_id);
  if (!task) {
    return fail("Task not found", 404);
  }

  const project = getProject(task.project_id);
  if (!project) {
    return fail("Project not found", 404);
  }

  const row = getDb().prepare("SELECT config_json FROM agents WHERE id = ?").get(agent.id) as { config_json: string } | undefined;
  const config = parseJson<Record<string, unknown>>(row?.config_json ?? "{}", {});
  const openclawId = config.openclawId as string | number | undefined;
  if (!openclawId) {
    return fail("Agent is missing openclawId", 400);
  }

  const mcUrl = request.headers.get("origin") ?? new URL(request.url).origin;
  const prompt = buildPrompt({
    projectName: project.name,
    projectDescription: project.description,
    taskId: task.id,
    title: task.title,
    description: task.description,
    priority: task.priority,
    mcUrl,
  });

  const tool = context.actor.kind === "agent" && agent.parent_id === context.actor.id ? "sessions_spawn" : "sessions_send";
  const data = await invoke(tool, {
    openclawId,
    prompt,
    taskId: task.id,
    projectId: project.id,
    agentId: agent.id,
  }, `task:${task.id}`);

  return ok({ tool, data });
}, { allow: ["user", "agent"] });
