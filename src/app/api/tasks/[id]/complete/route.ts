import { NextRequest } from "next/server";

import { actorIsAgent, withAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { emitEvent, recordEvent } from "@/lib/events";
import { fail, ok } from "@/lib/http";
import { readRouteId } from "@/lib/route";
import { taskCompleteSchema } from "@/lib/schemas";
import { completeTask, getTask } from "@/lib/store";

export const POST = withAuth(async (request: NextRequest, context, routeContext) => {
  const id = await readRouteId(routeContext);
  const task = getTask(id);
  if (!task) {
    return fail("Task not found", 404);
  }

  if (actorIsAgent(context.actor) && task.assigned_agent_id !== context.actor.id) {
    return fail("Forbidden", 403);
  }

  const body = taskCompleteSchema.parse(await request.json());
  const event = getDb().transaction(() => {
    const updated = completeTask(id, body.result);
    if (!updated) {
      throw new Error("Task not found");
    }

    return recordEvent({ kind: "task.updated", payload: { task: updated } }, false);
  })();

  emitEvent(event);
  return ok({});
}, { allow: ["user", "agent"] });
