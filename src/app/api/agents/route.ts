import { NextRequest } from "next/server";

import { actorIsUser, withAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { emitEvent, recordEvent } from "@/lib/events";
import { fail, ok } from "@/lib/http";
import { openclawAgentsAdd, openclawAgentsDelete } from "@/lib/openclaw-cli";
import { agentCreateSchema } from "@/lib/schemas";
import { createAgent, listAgentsTree } from "@/lib/store";

export const GET = withAuth(async () => ok(listAgentsTree()), { allow: ["user", "agent"] });

export const POST = withAuth(async (request: NextRequest, context) => {
  if (!actorIsUser(context.actor)) {
    return fail("Forbidden", 403);
  }

  const body = agentCreateSchema.parse(await request.json());

  const ocResult = await openclawAgentsAdd(body.name);
  const mergedConfig = { ...(body.config ?? {}), openclawId: ocResult.agentId, openclawWorkspace: ocResult.workspace };

  let created;
  let event;
  try {
    ({ created, event } = getDb().transaction(() => {
      const c = createAgent({ ...body, config: mergedConfig });
      const e = recordEvent({ kind: "agent.created", payload: { agent: c.agent } }, false);
      return { created: c, event: e };
    })());
  } catch (err) {
    await openclawAgentsDelete(ocResult.agentId).catch(() => {});
    throw err;
  }

  emitEvent(event);
  return ok(created);
}, { allow: ["user"] });
