import "server-only";

import { spawn } from "node:child_process";
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

function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("openclaw", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (b) => (stdout += b.toString()));
    proc.stderr.on("data", (b) => (stderr += b.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

type AddResult = { agentId: string; name: string; workspace: string; agentDir: string };

export async function openclawAgentsAdd(name: string, opts?: { model?: string }): Promise<AddResult> {
  const id = slugifyAgentId(name);
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
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
