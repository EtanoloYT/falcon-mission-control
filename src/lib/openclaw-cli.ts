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

export async function openclawAgentsDelete(id: string): Promise<void> {
  const { code, stdout, stderr } = await run(["agents", "delete", id, "--force", "--json"]);
  if (code !== 0) {
    throw new Error(`openclaw agents delete failed (${code}): ${stderr || stdout}`);
  }
}
