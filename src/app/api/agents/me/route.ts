import { NextRequest } from "next/server";

import { actorIsAgent, withAuth } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { getAgent, getTask } from "@/lib/store";

/**
 * Identity endpoint for the Mission Control MCP server. The shared server has
 * no identity of its own, so everything here is derived from the caller's
 * per-task token: who they are, and which task they were dispatched for.
 */
export const GET = withAuth(async (_request: NextRequest, context) => {
  if (!actorIsAgent(context.actor)) {
    return fail("Forbidden", 403);
  }

  const agent = getAgent(context.actor.id);
  if (!agent) {
    return fail("Agent not found", 404);
  }

  const task = context.actor.taskId ? getTask(context.actor.taskId) : null;

  return ok({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    task,
  });
}, { allow: ["agent"] });
