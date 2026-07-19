import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "mc_session";

async function sha256Hex(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(bytes: number) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(request: NextRequest) {
  const existing = request.cookies.get(SESSION_COOKIE)?.value;
  if (existing) {
    return NextResponse.next();
  }

  const secret = process.env.MC_API_KEY;
  if (!secret) {
    return NextResponse.next();
  }

  const sessionId = randomHex(24);
  const signature = await sha256Hex(`${sessionId}.${secret}`);
  const token = `${sessionId}.${signature}`;

  const requestHeaders = new Headers(request.headers);
  const cookieHeader = requestHeaders.get("cookie");
  const forwardedCookie = cookieHeader ? `${cookieHeader}; ${SESSION_COOKIE}=${token}` : `${SESSION_COOKIE}=${token}`;
  requestHeaders.set("cookie", forwardedCookie);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
