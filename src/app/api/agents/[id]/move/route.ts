import { NextRequest } from "next/server";

import { actorIsUser, withAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { emitEvent, recordEvent } from "@/lib/events";
import { fail, ok } from "@/lib/http";
import { readRouteId } from "@/lib/route";
import { agentMoveSchema } from "@/lib/schemas";
import { getAgent, moveAgent } from "@/lib/store";

export const POST = withAuth(async (request: NextRequest, context, routeContext) => {
  if (!actorIsUser(context.actor)) {
    return fail("Forbidden", 403);
  }

  const id = await readRouteId(routeContext);
  const body = agentMoveSchema.parse(await request.json());
  const agent = getAgent(id);
  if (!agent) {
    return fail("Agent not found", 404);
  }

  let moveFailure: "parent_not_found" | "self_parent" | "cycle" | null = null;

  const event = getDb().transaction(() => {
    const result = moveAgent(id, body.new_parent_id);
    if (!result.ok) {
      if (result.reason === "not_found") {
        return null;
      }
      moveFailure = result.reason;
      return null;
    }

    return recordEvent({ kind: "agent.updated", payload: { agent: result.agent } }, false);
  })();

  if (moveFailure === "cycle") {
    return fail("Cannot move an agent under its own descendant", 400);
  }
  if (moveFailure === "self_parent") {
    return fail("An agent cannot be its own parent", 400);
  }
  if (moveFailure === "parent_not_found") {
    return fail("New parent agent not found", 400);
  }
  if (!event) {
    return fail("Agent not found", 404);
  }

  emitEvent(event);
  return ok({});
}, { allow: ["user"] });
