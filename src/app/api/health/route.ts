import { NextResponse } from "next/server";

import { invoke } from "@/lib/openclaw";

let cachedHealth: { reachable: boolean; uptime?: number; reason?: string; ts: number } | null = null;

function respond(data: { reachable: boolean; uptime?: number; reason?: string }) {
  return NextResponse.json({
    ok: true,
    data: { gateway: data },
    gateway: data,
  });
}

export async function GET() {
  const now = Date.now();
  if (cachedHealth && now - cachedHealth.ts < 5000) {
    return respond({ reachable: cachedHealth.reachable, uptime: cachedHealth.uptime, reason: cachedHealth.reason });
  }

  if (!process.env.OPENCLAW_GATEWAY_URL || !process.env.OPENCLAW_GATEWAY_TOKEN) {
    cachedHealth = {
      reachable: false,
      reason: "OPENCLAW_GATEWAY_URL and/or OPENCLAW_GATEWAY_TOKEN are missing",
      ts: now,
    };
    return respond({ reachable: false, reason: cachedHealth.reason });
  }

  try {
    const result = (await invoke("session_status", {})) as { uptime?: number } | undefined;
    cachedHealth = {
      reachable: true,
      uptime: result?.uptime,
      reason: undefined,
      ts: now,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gateway request failed";
    cachedHealth = {
      reachable: false,
      reason: message,
      ts: now,
    };
  }

  return respond({ reachable: cachedHealth.reachable, uptime: cachedHealth.uptime, reason: cachedHealth.reason });
}
