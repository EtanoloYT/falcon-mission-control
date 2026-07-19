import { NextRequest } from "next/server";

import { withAuth } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { openclawInvokeSchema } from "@/lib/schemas";
import { invoke } from "@/lib/openclaw";

export const POST = withAuth(async (request: NextRequest) => {
  const body = openclawInvokeSchema.parse(await request.json());

  try {
    const data = await invoke(body.tool, body.args, body.sessionKey);
    return ok(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenClaw request failed";
    if (message.includes("not allowed")) {
      return fail(message, 404);
    }

    return fail(message, 502);
  }
}, { allow: ["user"] });
