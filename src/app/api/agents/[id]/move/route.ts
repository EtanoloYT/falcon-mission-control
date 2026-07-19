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

  const event = getDb().transaction(() => {
    const updated = moveAgent(id, body.new_parent_id);
    if (!updated) {
      throw new Error("Agent not found");
    }

    return recordEvent({ kind: "agent.updated", payload: { agent: updated } }, false);
  })();

  emitEvent(event);
  return ok({});
}, { allow: ["user"] });
