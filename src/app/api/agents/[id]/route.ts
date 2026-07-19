import { NextRequest } from "next/server";

import { actorIsUser, withAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { emitEvent, recordEvent } from "@/lib/events";
import { fail, ok } from "@/lib/http";
import { readRouteId } from "@/lib/route";
import { openclawAgentsDelete } from "@/lib/openclaw-cli";
import { agentPatchSchema } from "@/lib/schemas";
import { deleteAgent, getAgent, updateAgent } from "@/lib/store";

export const GET = withAuth(async (_request: NextRequest, _context, routeContext) => {
  const id = await readRouteId(routeContext);
  const agent = getAgent(id);
  if (!agent) {
    return fail("Agent not found", 404);
  }

  return ok(agent);
}, { allow: ["user", "agent"] });

export const PATCH = withAuth(async (request: NextRequest, context, routeContext) => {
  if (!actorIsUser(context.actor)) {
    return fail("Forbidden", 403);
  }

  const id = await readRouteId(routeContext);
  const body = agentPatchSchema.parse(await request.json());
  const event = getDb().transaction(() => {
    const agent = updateAgent(id, body);
    if (!agent) {
      throw new Error("Agent not found");
    }

    return recordEvent({ kind: "agent.updated", payload: { agent } }, false);
  })();

  emitEvent(event);
  return ok({});
}, { allow: ["user"] });

export const DELETE = withAuth(async (_request: NextRequest, context, routeContext) => {
  if (!actorIsUser(context.actor)) {
    return fail("Forbidden", 403);
  }

  const id = await readRouteId(routeContext);
  const agent = getAgent(id);
  if (!agent) {
    return fail("Agent not found", 404);
  }

  const openclawId = (agent.config as { openclawId?: string } | undefined)?.openclawId;
  if (openclawId) {
    await openclawAgentsDelete(openclawId).catch((err) => {
      console.warn(`openclaw agents delete ${openclawId} failed:`, err);
    });
  }

  const event = getDb().transaction(() => {
    const removed = deleteAgent(id);
    if (!removed) {
      throw new Error("Agent not found");
    }

    return recordEvent({ kind: "agent.deleted", payload: { agent_id: id } }, false);
  })();

  emitEvent(event);
  return ok({});
}, { allow: ["user"] });
