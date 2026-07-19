import { NextRequest, NextResponse } from "next/server";

import { createSessionToken, getSessionCookieName } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { apiKey?: string };
  const mcApiKey = process.env.MC_API_KEY;

  if (!mcApiKey || !body.apiKey || body.apiKey !== mcApiKey) {
    return NextResponse.json({ ok: false, error: "Invalid admin API key" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, data: { authenticated: true } });
  response.cookies.set(getSessionCookieName(), createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });

  return response;
}
