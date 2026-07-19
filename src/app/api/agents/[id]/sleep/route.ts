import { NextRequest } from "next/server";

import { actorIsUser, withAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { emitEvent, recordEvent } from "@/lib/events";
import { fail, ok } from "@/lib/http";
import { readRouteId } from "@/lib/route";
import { getAgent, sleepAgent } from "@/lib/store";

export const POST = withAuth(async (_request: NextRequest, context, routeContext) => {
  if (!actorIsUser(context.actor)) {
    return fail("Forbidden", 403);
  }

  const id = await readRouteId(routeContext);
  const agent = getAgent(id);
  if (!agent) {
    return fail("Agent not found", 404);
  }

  const event = getDb().transaction(() => {
    const updated = sleepAgent(id);
    if (!updated) {
      throw new Error("Agent not found");
    }

    return recordEvent({ kind: "agent.status", payload: { agent: updated } }, false);
  })();

  emitEvent(event);
  return ok({});
}, { allow: ["user"] });
