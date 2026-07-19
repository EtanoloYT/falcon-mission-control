import { NextRequest, NextResponse } from "next/server";

import { actorIsUser, withAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { emitEvent, recordEvent } from "@/lib/events";
import { fail, ok } from "@/lib/http";
import { projectCreateSchema, projectPatchSchema } from "@/lib/schemas";
import { createProject, deleteProject, getProject, listProjects, updateProject } from "@/lib/store";

export const GET = withAuth(async () => ok(listProjects()), { allow: ["user", "agent"] });

export const POST = withAuth(async (request: NextRequest, context) => {
  if (!actorIsUser(context.actor)) {
    return fail("Forbidden", 403);
  }

  const body = projectCreateSchema.parse(await request.json());
  const { project, event } = getDb().transaction(() => {
    const project = createProject(body);
    if (!project) {
      throw new Error("Failed to create project");
    }

    const event = recordEvent({ kind: "project.created", payload: { project } }, false);
    return { project, event };
  })();

  emitEvent(event);
  return ok(project);
}, { allow: ["user"] });
