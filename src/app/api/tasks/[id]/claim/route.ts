import { NextRequest } from "next/server";

import { actorIsAgent, withAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { emitEvent, recordEvent } from "@/lib/events";
import { fail, ok } from "@/lib/http";
import { readRouteId } from "@/lib/route";
import { claimTask, getTask } from "@/lib/store";

export const POST = withAuth(async (_request: NextRequest, context, routeContext) => {
  if (!actorIsAgent(context.actor)) {
    return fail("Forbidden", 403);
  }

  const id = await readRouteId(routeContext);
  const agentId = context.actor.id;
  const task = getTask(id);
  if (!task) {
    return fail("Task not found", 404);
  }

  const event = getDb().transaction(() => {
    const updated = claimTask(id, agentId);
    if (!updated) {
      throw new Error("Task not found");
    }

    return recordEvent({ kind: "task.updated", payload: { task: updated } }, false);
  })();

  emitEvent(event);
  return ok({});
}, { allow: ["agent"] });
