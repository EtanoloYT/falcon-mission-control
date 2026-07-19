import { NextRequest } from "next/server";

import { actorIsUser, withAuth } from "@/lib/auth";
import { importAgentsFromOpenclaw } from "@/lib/agent-import";
import { fail, ok } from "@/lib/http";

export const POST = withAuth(async (_request: NextRequest, context) => {
  if (!actorIsUser(context.actor)) {
    return fail("Forbidden", 403);
  }

  try {
    const summary = await importAgentsFromOpenclaw();
    return ok(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return fail(message, 502);
  }
}, { allow: ["user"] });
