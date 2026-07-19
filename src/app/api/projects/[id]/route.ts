import { NextRequest } from "next/server";

import { actorIsUser, withAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { emitEvent, recordEvent } from "@/lib/events";
import { fail, ok } from "@/lib/http";
import { readRouteId } from "@/lib/route";
import { projectPatchSchema } from "@/lib/schemas";
import { deleteProject, getProject, updateProject } from "@/lib/store";

export const GET = withAuth(async (_request: NextRequest, _context, routeContext) => {
  const id = await readRouteId(routeContext);
  const project = getProject(id);
  if (!project) {
    return fail("Project not found", 404);
  }

  return ok(project);
}, { allow: ["user", "agent"] });

export const PATCH = withAuth(async (request: NextRequest, context, routeContext) => {
  if (!actorIsUser(context.actor)) {
    return fail("Forbidden", 403);
  }

  const id = await readRouteId(routeContext);
  const body = projectPatchSchema.parse(await request.json());
  const event = getDb().transaction(() => {
    const project = updateProject(id, body);
    if (!project) {
      throw new Error("Project not found");
    }

    return recordEvent({ kind: "project.updated", payload: { project } }, false);
  })();

  emitEvent(event);
  return ok({});
}, { allow: ["user"] });

export const DELETE = withAuth(async (_request: NextRequest, context, routeContext) => {
  if (!actorIsUser(context.actor)) {
    return fail("Forbidden", 403);
  }

  const id = await readRouteId(routeContext);
  const project = getProject(id);
  if (!project) {
    return fail("Project not found", 404);
  }

  const event = getDb().transaction(() => {
    const removed = deleteProject(id);
    if (!removed) {
      throw new Error("Project not found");
    }

    return recordEvent({ kind: "project.deleted", payload: { project_id: id } }, false);
  })();

  emitEvent(event);
  return ok({});
}, { allow: ["user"] });
