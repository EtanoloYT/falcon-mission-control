import "server-only";

import crypto from "node:crypto";

import { getApiKeySecret, sha256 } from "@/lib/db";
import { getTask } from "@/lib/store";

/**
 * Per-task capability tokens.
 *
 * OpenClaw exposes every configured MCP server to every agent — per-agent
 * `tools.allow`/`tools.deny` do not filter MCP tools, and MCP server entries
 * have no agent-scoping field. So a server whose identity lives in its env
 * block proves nothing: any agent can call any other agent's server. Identity
 * has to travel with the call instead.
 *
 * A token binds one agent to one task for one dispatch. It is minted when the
 * task is dispatched and injected into that run's prompt, so an agent can only
 * act as whoever Mission Control actually woke.
 *
 * Stateless by design (HMAC over the claim, no token table): a Next restart
 * mid-run would otherwise strand every in-flight agent holding a dead token.
 * Revocation comes from re-checking the live assignment at verify time, which
 * is stronger than a stored token would give us anyway — reassign a task and
 * every previously issued token for it stops working immediately.
 */

/** Long enough to outlive the 900s dispatch timeout and a slow retry, short enough to bound replay. */
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

export type TaskTokenClaim = {
  taskId: number;
  agentId: number;
};

function sign(payload: string) {
  return sha256(`task-token.${payload}.${getApiKeySecret()}`);
}

export function issueTaskToken(claim: TaskTokenClaim, nowMs = Date.now()) {
  const payload = `${claim.taskId}.${claim.agentId}.${nowMs + TOKEN_TTL_MS}`;
  return `mct_${payload}.${sign(payload)}`;
}

export type TaskTokenResult =
  | { ok: true; claim: TaskTokenClaim }
  | { ok: false; error: string };

export function verifyTaskToken(raw: string | null | undefined, nowMs = Date.now()): TaskTokenResult {
  if (!raw || typeof raw !== "string") {
    return { ok: false, error: "Missing task_token. Use the work_token value from your task prompt." };
  }

  const body = raw.trim().startsWith("mct_") ? raw.trim().slice(4) : null;
  if (!body) {
    return { ok: false, error: "Malformed task_token. Copy the work_token from your task prompt exactly." };
  }

  const parts = body.split(".");
  if (parts.length !== 4) {
    return { ok: false, error: "Malformed task_token. Copy the work_token from your task prompt exactly." };
  }

  const [taskIdRaw, agentIdRaw, expiresRaw, signature] = parts;
  const payload = `${taskIdRaw}.${agentIdRaw}.${expiresRaw}`;
  const expected = sign(payload);

  // Constant-time compare so a caller cannot brute-force a signature byte by byte.
  const provided = Buffer.from(signature, "utf8");
  const control = Buffer.from(expected, "utf8");
  if (provided.length !== control.length || !crypto.timingSafeEqual(provided, control)) {
    return { ok: false, error: "Invalid task_token signature." };
  }

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < nowMs) {
    return { ok: false, error: "This task_token has expired. Mission Control must dispatch the task again." };
  }

  const taskId = Number(taskIdRaw);
  const agentId = Number(agentIdRaw);
  if (!Number.isInteger(taskId) || !Number.isInteger(agentId)) {
    return { ok: false, error: "Malformed task_token." };
  }

  // The signature only proves Mission Control minted this claim. Whether it is
  // still true is a live question — a reassigned task must invalidate it.
  const task = getTask(taskId);
  if (!task) {
    return { ok: false, error: `Task #${taskId} no longer exists.` };
  }
  if (task.assigned_agent_id !== agentId) {
    return {
      ok: false,
      error: `Task #${taskId} is no longer assigned to you. Mission Control reassigned it.`,
    };
  }

  return { ok: true, claim: { taskId, agentId } };
}
