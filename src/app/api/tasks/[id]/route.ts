import { NextRequest } from "next/server";

import { actorIsAgent, actorIsUser, withAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { emitEvent, recordEvent } from "@/lib/events";
import { fail, ok } from "@/lib/http";
import { readRouteId } from "@/lib/route";
import { taskPatchSchema } from "@/lib/schemas";
import { enqueueTaskDispatch } from "@/lib/dispatch";
import { deleteTask, getTask, listTaskComments, updateTask } from "@/lib/store";

export const GET = withAuth(async (_request: NextRequest, _context, routeContext) => {
  const id = await readRouteId(routeContext);
  const task = getTask(id);
  if (!task) {
    return fail("Task not found", 404);
  }

  return ok({ ...task, comments: listTaskComments(id) });
}, { allow: ["user", "agent"] });

export const PATCH = withAuth(async (request: NextRequest, context, routeContext) => {
  const id = await readRouteId(routeContext);
  const task = getTask(id);
  if (!task) {
    return fail("Task not found", 404);
  }

  if (actorIsAgent(context.actor) && task.assigned_agent_id !== context.actor.id) {
    return fail("Forbidden", 403);
  }

  const body = taskPatchSchema.parse(await request.json());
  const event = getDb().transaction(() => {
    const updated = updateTask(id, body);
    if (!updated) {
      throw new Error("Task not found");
    }

    return recordEvent({ kind: "task.updated", payload: { task: updated } }, false);
  })();

  emitEvent(event);
  const assignedAgentChanged =
    body.assigned_agent_id !== undefined &&
    body.assigned_agent_id !== null &&
    body.assigned_agent_id !== task.assigned_agent_id;
  const explicitlyAssigned = body.status === "assigned" && (body.assigned_agent_id ?? task.assigned_agent_id);
  if (assignedAgentChanged || explicitlyAssigned) {
    enqueueTaskDispatch({
      taskId: id,
      agentId: body.assigned_agent_id ?? task.assigned_agent_id,
    });
  }
  return ok({});
}, { allow: ["user", "agent"] });

export const DELETE = withAuth(async (_request: NextRequest, context, routeContext) => {
  if (!actorIsUser(context.actor)) {
    return fail("Forbidden", 403);
  }

  const id = await readRouteId(routeContext);
  const task = getTask(id);
  if (!task) {
    return fail("Task not found", 404);
  }

  const event = getDb().transaction(() => {
    const removed = deleteTask(id);
    if (!removed) {
      throw new Error("Task not found");
    }

    return recordEvent({ kind: "task.deleted", payload: { task_id: id } }, false);
  })();

  emitEvent(event);
  return ok({});
}, { allow: ["user"] });
