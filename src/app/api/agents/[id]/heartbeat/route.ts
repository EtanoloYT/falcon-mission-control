import { NextRequest } from "next/server";

import { actorIsAgent, withAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { emitEvent, recordEvent } from "@/lib/events";
import { fail, ok } from "@/lib/http";
import { readRouteId } from "@/lib/route";
import { getAgent, heartbeatAgent } from "@/lib/store";

export const POST = withAuth(async (_request: NextRequest, context, routeContext) => {
  const id = await readRouteId(routeContext);
  if (actorIsAgent(context.actor) && context.actor.id !== id) {
    return fail("Forbidden", 403);
  }

  const agent = getAgent(id);
  if (!agent) {
    return fail("Agent not found", 404);
  }

  const event = getDb().transaction(() => {
    const updated = heartbeatAgent(id);
    if (!updated) {
      throw new Error("Agent not found");
    }

    return recordEvent({ kind: "heartbeat", payload: { agent: updated } }, false);
  })();

  emitEvent(event);
  return ok({});
}, { allow: ["user", "agent"] });
