import "server-only";

import crypto from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { getApiKeySecret, getDb, sha256, type AgentRow } from "@/lib/db";

export type Actor =
  | {
      kind: "user";
    }
  | {
      kind: "agent";
      id: number;
      name: string;
    };

type AllowedActor = Actor["kind"];

export type AuthContext = {
  actor: Actor;
};

const sessionCookieName = "mc_session";

export function getSessionCookieName() {
  return sessionCookieName;
}

export function createSessionToken() {
  const sessionId = crypto.randomBytes(24).toString("hex");
  const signature = sha256(`${sessionId}.${getApiKeySecret()}`);
  return `${sessionId}.${signature}`;
}

function verifySessionToken(value: string | undefined | null) {
  if (!value) {
    return false;
  }

  const [sessionId, signature] = value.split(".");
  if (!sessionId || !signature) {
    return false;
  }

  const expected = sha256(`${sessionId}.${getApiKeySecret()}`);
  return signature === expected;
}

function resolveBearerActor(token: string | undefined | null): Actor | null {
  if (!token) {
    return null;
  }

  if (token === getApiKeySecret()) {
    return { kind: "user" };
  }

  const hashed = sha256(token);
  const agent = getDb()
    .prepare("SELECT id, name, api_key FROM agents WHERE api_key = ?")
    .get(hashed) as AgentRow | undefined;

  if (!agent) {
    return null;
  }

  return {
    kind: "agent",
    id: agent.id,
    name: agent.name,
  };
}

export function resolveActor(request: NextRequest): Actor | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return resolveBearerActor(authorization.slice(7).trim());
  }

  if (verifySessionToken(request.cookies.get(sessionCookieName)?.value)) {
    return { kind: "user" };
  }

  return null;
}

export function withAuth<
  TContext extends { params?: Promise<Record<string, string>> | Record<string, string> } = { params?: Promise<Record<string, string>> | Record<string, string> }
>(
  handler: (request: NextRequest, context: AuthContext, routeContext: TContext) => Promise<Response> | Response,
  options: { allow: AllowedActor[] }
) {
  return (async (request: NextRequest, routeContext?: unknown) => {
    const actor = resolveActor(request);
    if (!actor) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!options.allow.includes(actor.kind)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const requestWithContext = request as NextRequest & { ctx?: AuthContext };
    requestWithContext.ctx = { actor };

    try {
      return await handler(requestWithContext, { actor }, (routeContext ?? {}) as TContext);
    } catch (error) {
      // Schema failures are the caller's fault, not a server fault. Agents call
      // these routes through MCP tools and need a readable reason, not a 500.
      if (error instanceof ZodError) {
        const detail = error.issues
          .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
          .join("; ");
        return NextResponse.json({ ok: false, error: `Invalid request — ${detail}` }, { status: 400 });
      }
      throw error;
    }
  }) as unknown as (request: NextRequest, routeContext?: unknown) => Promise<Response>;
}

export function actorIsUser(actor: Actor | null) {
  return actor?.kind === "user";
}

export function actorIsAgent(actor: Actor | null) {
  return actor?.kind === "agent";
}

export function maskApiKey(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
