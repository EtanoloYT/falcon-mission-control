import { NextRequest } from "next/server";

import { actorIsAgent, withAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { emitEvent, recordEvent } from "@/lib/events";
import { fail, ok } from "@/lib/http";
import { readRouteId } from "@/lib/route";
import { taskCommentCreateSchema } from "@/lib/schemas";
import { addTaskComment, getTask } from "@/lib/store";

export const POST = withAuth(async (request: NextRequest, context, routeContext) => {
  const id = await readRouteId(routeContext);
  const task = getTask(id);
  if (!task) {
    return fail("Task not found", 404);
  }

  const body = taskCommentCreateSchema.parse(await request.json());
  const authorAgentId = actorIsAgent(context.actor) ? context.actor.id : null;
  const authorKind = actorIsAgent(context.actor) ? "agent" : "user";

  const event = getDb().transaction(() => {
    const comment = addTaskComment({
      task_id: id,
      author_agent_id: authorAgentId,
      author_kind: authorKind,
      body: body.body,
    });

    if (!comment) {
      throw new Error("Failed to add comment");
    }

    return recordEvent({ kind: "task.comment", payload: { task_id: id, comment } }, false);
  })();

  emitEvent(event);
  return ok({});
}, { allow: ["user", "agent"] });
