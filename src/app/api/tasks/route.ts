import { NextRequest } from "next/server";

import { actorIsAgent, withAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { emitEvent, recordEvent } from "@/lib/events";
import { fail, ok } from "@/lib/http";
import { taskCreateSchema, taskQuerySchema } from "@/lib/schemas";
import { createTask, listTasks } from "@/lib/store";

export const GET = withAuth(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const filters = taskQuerySchema.parse({
    project_id: searchParams.get("project_id") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    agent_id: searchParams.get("agent_id") ?? undefined,
  });

  return ok(listTasks(filters));
}, { allow: ["user", "agent"] });

export const POST = withAuth(async (request: NextRequest, context) => {
  const body = taskCreateSchema.parse(await request.json());
  const createdByAgentId = actorIsAgent(context.actor) ? context.actor.id : null;

  const { task, event } = getDb().transaction(() => {
    const task = createTask({ ...body, created_by_agent_id: createdByAgentId });
    if (!task) {
      throw new Error("Failed to create task");
    }

    const event = recordEvent({ kind: "task.created", payload: { task } }, false);
    return { task, event };
  })();

  emitEvent(event);
  return ok(task);
}, { allow: ["user", "agent"] });
