import "server-only";

import crypto from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { getApiKeySecret, getDb, sha256, type AgentRow } from "@/lib/db";
import { verifyTaskToken } from "@/lib/task-token";

export type Actor =
  | {
      kind: "user";
    }
  | {
      kind: "agent";
      id: number;
      name: string;
      /** Set when the agent authenticated with a per-task token, scoping it to that task. */
      taskId?: number;
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

/**
 * Agents reach Mission Control through one shared MCP server, so they cannot be
 * told apart by which server they called. Identity rides in this header as a
 * per-task token minted at dispatch. See lib/task-token.ts for why.
 */
export const taskTokenHeader = "x-mc-task-token";

/** Surfaced to the MCP server so a bad token explains itself instead of reading as a flat 401. */
export const taskTokenErrorHeader = "x-mc-task-token-error";

function resolveTaskTokenActor(token: string | null): { actor: Actor } | { error: string } | null {
  if (!token) {
    return null;
  }

  const verified = verifyTaskToken(token);
  if (!verified.ok) {
    return { error: verified.error };
  }

  const agent = getDb()
    .prepare("SELECT id, name FROM agents WHERE id = ?")
    .get(verified.claim.agentId) as AgentRow | undefined;

  if (!agent) {
    return { error: "The agent this task_token belongs to no longer exists." };
  }

  return { actor: { kind: "agent", id: agent.id, name: agent.name, taskId: verified.claim.taskId } };
}

export function resolveActor(request: NextRequest): Actor | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return resolveBearerActor(authorization.slice(7).trim());
  }

  const viaTaskToken = resolveTaskTokenActor(request.headers.get(taskTokenHeader));
  if (viaTaskToken) {
    // A caller that presented a task token is an agent making a claim about
    // itself. If that claim is bad, fail it — do not fall through to the
    // session cookie, or middleware.ts's auto-issued session would silently
    // upgrade a rejected agent into a full user.
    return "actor" in viaTaskToken ? viaTaskToken.actor : null;
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
      // A rejected task token has a specific, actionable reason (expired,
      // reassigned, malformed). Returning a flat "Unauthorized" would send the
      // agent into a blind retry loop.
      const tokenAttempt = request.headers.get(taskTokenHeader)
        ? resolveTaskTokenActor(request.headers.get(taskTokenHeader))
        : null;
      const reason =
        tokenAttempt && "error" in tokenAttempt ? tokenAttempt.error : "Unauthorized";
      return NextResponse.json({ ok: false, error: reason }, { status: 401 });
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
