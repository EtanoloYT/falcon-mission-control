import { NextRequest } from "next/server";

import { withAuth } from "@/lib/auth";
import { enqueueTaskDispatch } from "@/lib/dispatch";
import { fail, ok } from "@/lib/http";
import { openclawDispatchSchema } from "@/lib/schemas";
import { getAgent, getTask } from "@/lib/store";

export const POST = withAuth(async (request: NextRequest) => {
  const body = openclawDispatchSchema.parse(await request.json());
  const agent = getAgent(body.agent_id);
  if (!agent) {
    return fail("Agent not found", 404);
  }

  const task = getTask(body.task_id);
  if (!task) {
    return fail("Task not found", 404);
  }

  const outcome = enqueueTaskDispatch({ taskId: task.id, agentId: agent.id });
  if (!outcome.queued) {
    return fail(outcome.reason ?? "OpenClaw dispatch failed", 409);
  }

  return ok({ tool: "openclaw_agent", ...outcome }, 202);
}, { allow: ["user", "agent"] });
