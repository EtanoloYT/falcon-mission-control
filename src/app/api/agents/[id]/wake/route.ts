import { NextRequest } from "next/server";

import { actorIsUser, withAuth } from "@/lib/auth";
import { enqueueAgentWake } from "@/lib/dispatch";
import { fail, ok } from "@/lib/http";
import { readRouteId } from "@/lib/route";
import { getAgent } from "@/lib/store";

export const POST = withAuth(async (_request: NextRequest, context, routeContext) => {
  if (!actorIsUser(context.actor)) {
    return fail("Forbidden", 403);
  }

  const id = await readRouteId(routeContext);
  const agent = getAgent(id);
  if (!agent) {
    return fail("Agent not found", 404);
  }

  const outcome = enqueueAgentWake(id);
  if (!outcome.queued) {
    return fail(outcome.reason ?? "OpenClaw wake failed", 409);
  }
  return ok(outcome, 202);
}, { allow: ["user"] });
