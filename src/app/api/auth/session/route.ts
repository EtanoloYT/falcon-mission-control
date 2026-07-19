import { NextRequest, NextResponse } from "next/server";

import { resolveActor } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const actor = resolveActor(request);
  return NextResponse.json({
    ok: true,
    data: {
      authenticated: actor?.kind === "user",
      actor: actor ?? null,
    },
  });
}
