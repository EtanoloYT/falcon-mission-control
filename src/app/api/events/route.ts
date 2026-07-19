import { NextRequest } from "next/server";

import { withAuth } from "@/lib/auth";
import { ok } from "@/lib/http";
import { eventsQuerySchema } from "@/lib/schemas";
import { listEvents } from "@/lib/events";

export const GET = withAuth(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const { since, limit } = eventsQuerySchema.parse({
    since: searchParams.get("since") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });

  return ok(listEvents(since ?? 0, limit ?? 200));
}, { allow: ["user", "agent"] });
