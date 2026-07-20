import "server-only";

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function slugifyAgentId(name: string) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "agent";
  return `mc-${base}-${Math.random().toString(16).slice(2, 8)}`;
}

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

function resolveOpenclawExecutable() {
  const configured = process.env.OPENCLAW_BIN?.trim();
  if (configured) {
    return configured;
  }

  for (const candidate of ["/opt/homebrew/bin/openclaw", "/usr/local/bin/openclaw"]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "openclaw";
}

function appendBounded(current: string, chunk: Buffer) {
  if (Buffer.byteLength(current) >= MAX_CAPTURE_BYTES) {
    return current;
  }

  return (current + chunk.toString()).slice(0, MAX_CAPTURE_BYTES);
}

function run(
  args: string[],
  options: { timeoutMs?: number } = {}
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveOpenclawExecutable(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;

    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
      }, options.timeoutMs);
      timeout.unref();
    }

    proc.stdout.on("data", (chunk: Buffer) => (stdout = appendBounded(stdout, chunk)));
    proc.stderr.on("data", (chunk: Buffer) => (stderr = appendBounded(stderr, chunk)));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code: code ?? 0, stdout, stderr, timedOut });
    });
  });
}

type AddResult = { agentId: string; name: string; workspace: string; agentDir: string };

export async function openclawAgentsAdd(
  name: string,
  opts?: { model?: string; id?: string }
): Promise<AddResult> {
  const id = opts?.id ?? slugifyAgentId(name);
  const workspace = path.join(os.homedir(), ".openclaw", "workspaces", id);
  const args = ["agents", "add", id, "--non-interactive", "--workspace", workspace, "--json"];
  if (opts?.model) args.push("--model", opts.model);

  const { code, stdout, stderr } = await run(args);
  if (code !== 0) {
    throw new Error(`openclaw agents add failed (${code}): ${stderr || stdout}`);
  }

  const jsonStart = stdout.indexOf("{");
  if (jsonStart < 0) throw new Error(`unexpected output: ${stdout}`);
  const parsed = JSON.parse(stdout.slice(jsonStart)) as AddResult;
  return parsed;
}

export type OpenclawAgentListEntry = {
  id: string;
  name?: string;
  model?: string;
  workspace?: string;
  agentDir?: string;
  isDefault?: boolean;
  identityEmoji?: string;
  identitySource?: string;
  bindings?: number;
  routes?: string[];
  providers?: string[];
};

/**
 * Shells out to `openclaw agents list --json` (read-only — never add/delete).
 * Throws a descriptive error on: CLI missing (ENOENT), non-zero exit, or
 * unparseable/non-array output. Callers must not treat failures as "no agents".
 */
export async function openclawAgentsList(): Promise<OpenclawAgentListEntry[]> {
  let result: { code: number; stdout: string; stderr: string };
  try {
    result = await run(["agents", "list", "--json"]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `openclaw CLI not found or failed to launch (is it installed and on PATH?): ${message}`
    );
  }

  const { code, stdout, stderr } = result;
  if (code !== 0) {
    throw new Error(`openclaw agents list failed (exit ${code}): ${stderr || stdout || "no output"}`);
  }

  // The CLI can prefix a banner line, so start at the first JSON token rather
  // than parsing the whole stream (matches openclawAgentsAdd).
  let parsed: unknown;
  const jsonStart = stdout.indexOf("[");
  try {
    parsed = JSON.parse(jsonStart < 0 ? stdout : stdout.slice(jsonStart));
  } catch {
    throw new Error(`openclaw agents list returned unparseable JSON: ${stdout.slice(0, 500)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`openclaw agents list returned unexpected shape (expected array): ${stdout.slice(0, 500)}`);
  }

  return parsed as OpenclawAgentListEntry[];
}

export async function openclawAgentsDelete(id: string): Promise<void> {
  const { code, stdout, stderr } = await run(["agents", "delete", id, "--force", "--json"]);
  if (code !== 0) {
    throw new Error(`openclaw agents delete failed (${code}): ${stderr || stdout}`);
  }
}

type OpenclawAgentPayload = {
  text?: string;
  mediaUrl?: string | null;
};

type OpenclawAgentJson = {
  runId?: string;
  status?: string;
  summary?: string;
  error?: string;
  result?: {
    payloads?: OpenclawAgentPayload[];
    meta?: {
      durationMs?: number;
      /** OpenClaw nests these under `meta`, not directly on `result`. */
      finalAssistantVisibleText?: string;
      finalAssistantRawText?: string;
      agentMeta?: {
        sessionId?: string;
        provider?: string;
        model?: string;
      };
    };
  };
};

export type OpenclawThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type OpenclawAgentRun = {
  runId: string | null;
  text: string;
  durationMs: number | null;
  sessionId: string | null;
  provider: string | null;
  model: string | null;
};

function parseJsonObject(stdout: string): OpenclawAgentJson {
  const jsonStart = stdout.indexOf("{");
  if (jsonStart < 0) {
    throw new Error(`OpenClaw returned no JSON: ${stdout.slice(0, 500) || "empty output"}`);
  }

  try {
    return JSON.parse(stdout.slice(jsonStart)) as OpenclawAgentJson;
  } catch {
    throw new Error(`OpenClaw returned invalid JSON: ${stdout.slice(0, 500)}`);
  }
}

export function parseOpenclawAgentOutput(stdout: string): OpenclawAgentRun {
  const parsed = parseJsonObject(stdout);
  if (parsed.status !== "ok") {
    throw new Error(parsed.error || parsed.summary || `OpenClaw run ended with status ${parsed.status ?? "unknown"}`);
  }

  const payloadText = parsed.result?.payloads
    ?.map((payload) => payload.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join("\n\n");
  const text =
    payloadText ||
    parsed.result?.meta?.finalAssistantVisibleText?.trim() ||
    parsed.result?.meta?.finalAssistantRawText?.trim() ||
    "OpenClaw completed the task without a text response.";
  const agentMeta = parsed.result?.meta?.agentMeta;

  return {
    runId: parsed.runId ?? null,
    text,
    durationMs: parsed.result?.meta?.durationMs ?? null,
    sessionId: agentMeta?.sessionId ?? null,
    provider: agentMeta?.provider ?? null,
    model: agentMeta?.model ?? null,
  };
}

/** `openclaw agent` takes the prompt on argv; stay well clear of ARG_MAX. */
const MAX_MESSAGE_BYTES = 256 * 1024;

export function buildAgentRunArgs(input: {
  agentId: string;
  message: string;
  thinking?: OpenclawThinkingLevel;
  timeoutSeconds: number;
}) {
  return [
    "agent",
    "--agent",
    input.agentId,
    "--message",
    input.message,
    "--thinking",
    input.thinking ?? "low",
    "--timeout",
    String(input.timeoutSeconds),
    "--json",
  ];
}

/**
 * Run a real agent turn through the supported OpenClaw CLI/Gateway path.
 * The Gateway HTTP tools surface deliberately blocks sessions_send and
 * sessions_spawn, so Mission Control must use the agent RPC exposed here.
 *
 * Note: OpenClaw keeps one continuous session per agent. `--session-id` only
 * resumes a session that already exists, so Mission Control cannot pin a fresh
 * session per task; the prompt therefore restates full task context every run.
 */
export async function openclawAgentRun(input: {
  agentId: string;
  message: string;
  thinking?: OpenclawThinkingLevel;
  timeoutSeconds?: number;
}): Promise<OpenclawAgentRun> {
  const timeoutSeconds = input.timeoutSeconds ?? 900;
  const messageBytes = Buffer.byteLength(input.message);
  if (messageBytes > MAX_MESSAGE_BYTES) {
    throw new Error(`OpenClaw agent prompt is too large (${messageBytes} bytes, limit ${MAX_MESSAGE_BYTES})`);
  }

  const args = buildAgentRunArgs({ ...input, timeoutSeconds });
  const { code, stdout, stderr, timedOut } = await run(args, {
    timeoutMs: (timeoutSeconds + 30) * 1000,
  });

  if (timedOut) {
    throw new Error(`OpenClaw agent timed out after ${timeoutSeconds} seconds`);
  }
  if (code !== 0) {
    throw new Error(`OpenClaw agent failed (exit ${code}): ${(stderr || stdout || "no output").slice(0, 2000)}`);
  }

  return parseOpenclawAgentOutput(stdout);
}
