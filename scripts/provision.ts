/**
 * Provisions the premade Mission Control roster.
 *
 * Idempotent: re-running produces no config change. Writes to
 * ~/.openclaw/openclaw.json only through `openclaw config set --batch-file`,
 * which validates against the real schema and rotates its own backup — the
 * file holds live gateway and channel tokens and is never hand-edited here.
 *
 * Run with: pnpm provision
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { importAgentsFromOpenclaw } from "@/lib/agent-import";
import { openclawAgentsAdd, openclawAgentsList } from "@/lib/openclaw-cli";
import { listAgentsFlat, updateAgent } from "@/lib/store";

type RosterAgent = {
  openclawId: string;
  name: string;
  role: string;
  model?: { primary: string; fallbacks: string[] };
  thinkingDefault?: string;
  emoji: string;
  theme: string;
  rationale: string;
  soul: string;
  tools: { allow: string[]; deny: string[] };
};

type Roster = {
  defaults: {
    model: {
      primary: string;
      fallbacks: string[];
      contextWindow: number;
      maxTokens: number;
    };
    thinkingDefault: string;
    contextManagement: {
      contextTokens: number;
      providerTimeoutSeconds: number;
      compaction: Record<string, unknown>;
    };
    sandbox: Record<string, unknown>;
    denyTools: string[];
  };
  agents: RosterAgent[];
};

const repoRoot = process.cwd();
const roster: Roster = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "config", "roster.json"), "utf8")
);

/** One shared server for the whole roster. Its tools are namespaced `falconmc__*`. */
const SHARED_MCP_SERVER = "falconmc";

/**
 * Prefer the stable Homebrew symlink over process.execPath, which resolves to a
 * versioned Cellar path (…/node/25.9.0_2/bin/node) that breaks every agent's
 * tools on the next `brew upgrade node`.
 */
function nodeCommand() {
  for (const candidate of ["/opt/homebrew/bin/node", "/usr/local/bin/node"]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return process.execPath;
}

function openclaw(args: string[], input?: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const bin = process.env.OPENCLAW_BIN?.trim() || "/opt/homebrew/bin/openclaw";
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "0" } });
    let out = "";
    proc.stdout.on("data", (b) => (out += b.toString()));
    proc.stderr.on("data", (b) => (out += b.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code: code ?? 0, out }));
  });
}

/** Applies config edits atomically, validating first. Refuses to write on a failed dry run. */
async function applyConfig(operations: Array<{ path: string; value: unknown }>, label: string) {
  if (operations.length === 0) {
    console.log(`  ${label}: already up to date`);
    return;
  }

  const file = path.join(os.tmpdir(), `falcon-provision-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(operations), { mode: 0o600 });
  try {
    const dry = await openclaw(["config", "set", "--batch-file", file, "--dry-run"]);
    if (dry.code !== 0) {
      throw new Error(`config validation failed for ${label}:\n${dry.out}`);
    }

    const applied = await openclaw(["config", "set", "--batch-file", file]);
    if (applied.code !== 0) {
      throw new Error(`config write failed for ${label}:\n${applied.out}`);
    }
    console.log(`  ${label}: applied ${operations.length} change(s)`);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

async function main() {
  console.log("Falcon Mission Control — provisioning roster\n");

  // 1. Back up the live config alongside OpenClaw's own rotation.
  const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  const backup = `${configPath}.falcon-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(configPath, backup);
  console.log(`Backed up config -> ${backup}\n`);

  // Keep local models within a practical memory budget. OpenClaw otherwise
  // discovers qwen's 131k context and asks Ollama to reserve ~10 GB even for a
  // small task, which makes first-token latency and failure recovery terrible
  // on a laptop. Read only to resolve model indexes; writes still go through
  // the validated OpenClaw config CLI below.
  const liveConfig = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    models?: { providers?: { ollama?: { models?: Array<{ id?: string }> } } };
    mcp?: { servers?: Record<string, unknown> };
  };
  const ollamaModels = liveConfig.models?.providers?.ollama?.models ?? [];
  const modelOps: Array<{ path: string; value: unknown }> = [];
  modelOps.push(
    { path: "agents.defaults.contextTokens", value: roster.defaults.contextManagement.contextTokens },
    { path: "models.providers.ollama.timeoutSeconds", value: roster.defaults.contextManagement.providerTimeoutSeconds },
    { path: "agents.defaults.compaction", value: roster.defaults.contextManagement.compaction }
  );
  const requiredModels = [
    roster.defaults.model.primary,
    ...roster.defaults.model.fallbacks,
    ...roster.agents.flatMap((agent) =>
      agent.model ? [agent.model.primary, ...agent.model.fallbacks] : []
    ),
  ].filter((modelName, index, all) => all.indexOf(modelName) === index);

  for (const modelName of requiredModels) {
    const modelId = modelName.replace(/^ollama\//, "");
    let index = ollamaModels.findIndex((entry) => entry.id === modelId);
    if (index < 0) {
      index = ollamaModels.length;
      ollamaModels.push({ id: modelId });
      modelOps.push({
        path: `models.providers.ollama.models[${index}]`,
        value: {
          id: modelId,
          name: modelId,
          reasoning: true,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: roster.defaults.model.contextWindow,
          maxTokens: roster.defaults.model.maxTokens,
          params: { num_ctx: roster.defaults.model.contextWindow },
        },
      });
      continue;
    }
    modelOps.push(
      {
        path: `models.providers.ollama.models[${index}].contextWindow`,
        value: roster.defaults.model.contextWindow,
      },
      {
        path: `models.providers.ollama.models[${index}].maxTokens`,
        value: roster.defaults.model.maxTokens,
      },
      {
        path: `models.providers.ollama.models[${index}].params.num_ctx`,
        value: roster.defaults.model.contextWindow,
      }
    );
  }
  await applyConfig(modelOps, "local model limits");

  // 2. Create any missing OpenClaw agents with stable ids.
  console.log("OpenClaw agents:");
  const existing = await openclawAgentsList();
  const existingIds = new Set(existing.map((entry) => entry.id));
  for (const agent of roster.agents) {
    if (existingIds.has(agent.openclawId)) {
      console.log(`  ${agent.openclawId}: exists`);
      continue;
    }
    await openclawAgentsAdd(agent.name, {
      id: agent.openclawId,
      model: roster.defaults.model.primary,
    });
    console.log(`  ${agent.openclawId}: created`);
  }

  // 3. Shape each agent: model, identity, sandbox, tool policy.
  const afterAdd = await openclawAgentsList();
  const indexOf = new Map(afterAdd.map((entry, index) => [entry.id, index]));
  console.log("\nAgent config:");
  const configOps: Array<{ path: string; value: unknown }> = [];
  for (const agent of roster.agents) {
    const index = indexOf.get(agent.openclawId);
    if (index === undefined) {
      throw new Error(`${agent.openclawId} is missing from openclaw agents list after creation`);
    }

    const base = `agents.list[${index}]`;
    configOps.push(
      { path: `${base}.name`, value: agent.name },
      {
        path: `${base}.model`,
        value: agent.model ?? {
          primary: roster.defaults.model.primary,
          fallbacks: roster.defaults.model.fallbacks,
        },
      },
      {
        path: `${base}.thinkingDefault`,
        value: agent.thinkingDefault ?? roster.defaults.thinkingDefault,
      },
      { path: `${base}.identity`, value: { theme: agent.theme, emoji: agent.emoji } },
      { path: `${base}.sandbox`, value: roster.defaults.sandbox },
      // Mission Control supplies complete task context. Loading the global
      // skills catalog adds ~12k prompt characters and distracts small local
      // models with unrelated workflows, so roster agents intentionally have
      // no ambient skills.
      { path: `${base}.skills`, value: [] },
      {
        path: `${base}.tools`,
        value: {
          allow: [...agent.tools.allow, `${SHARED_MCP_SERVER}__*`].filter(
            (entry, position, all) => all.indexOf(entry) === position
          ),
          deny: [...new Set([...agent.tools.deny, ...roster.defaults.denyTools])],
        },
      }
    );
  }
  await applyConfig(configOps, "agent config");

  // 4. Mirror into Mission Control. agent-import.ts stays the only writer of
  //    agent rows; this just fills in what the import cannot infer.
  console.log("\nMission Control agents:");
  const summary = await importAgentsFromOpenclaw({
    allowedOpenclawIds: new Set(roster.agents.map((agent) => agent.openclawId)),
  });
  console.log(`  imported ${summary.imported}, updated ${summary.updated}, skipped ${summary.skipped}`);

  const mcAgents = listAgentsFlat();
  const byOpenclawId = new Map(
    mcAgents.map((agent) => [String((agent.config as { openclawId?: unknown }).openclawId ?? ""), agent])
  );

  // Roster roles are authoritative: inferRole guesses from keywords and bird
  // names carry none, so every roster agent would otherwise land as "agent".
  // No API keys are issued here any more — agents authenticate per task with a
  // work_token minted at dispatch, so there is nothing static to rotate.
  for (const agent of roster.agents) {
    const mcAgent = byOpenclawId.get(agent.openclawId);
    if (!mcAgent) {
      throw new Error(`${agent.openclawId} did not import into Mission Control`);
    }

    updateAgent(mcAgent.id, {
      name: agent.name,
      role: agent.role as never,
      soul: agent.soul,
      status: "idle",
    });

    console.log(`  ${agent.name} (#${mcAgent.id}, ${agent.role}) ready`);
  }

  // 5. Register ONE shared MCP server. Not one per agent: OpenClaw exposes
  //    every configured server to every agent (per-agent tools.allow/deny do
  //    not filter MCP tools, and server entries have no agent-scoping field),
  //    so per-agent servers gave no isolation while multiplying every agent's
  //    tool schemas by the roster size. Identity rides per call instead, as a
  //    work_token minted at dispatch — see lib/task-token.ts.
  console.log("\nMCP server:");
  const serverPath = path.join(repoRoot, "scripts", "mc-mcp-server.mjs");
  const baseUrl = process.env.MC_BASE_URL ?? "http://127.0.0.1:3030";
  await applyConfig(
    [
      {
        path: `mcp.servers.${SHARED_MCP_SERVER}`,
        value: {
          // The stable symlink, not process.execPath: that resolves to a
          // versioned Cellar path that dies on the next `brew upgrade node`.
          command: nodeCommand(),
          args: [serverPath],
          env: { MC_BASE_URL: baseUrl },
        },
      },
    ],
    "mcp server"
  );

  // Retire the per-agent servers from the previous design so their tool
  // schemas stop loading into every agent's context.
  const staleServers = roster.agents
    .map((agent) => `falconmc_${agent.openclawId.replace(/-/g, "_")}`)
    .filter(
      (name) => name !== SHARED_MCP_SERVER && Boolean(liveConfig.mcp?.servers?.[name])
    );
  for (const name of staleServers) {
    const removed = await openclaw(["mcp", "unset", name]);
    if (removed.code === 0) console.log(`  removed stale server ${name}`);
  }

  console.log("\nRestarting the gateway so the new config takes effect...");
  const restart = await openclaw(["daemon", "restart"]);
  console.log(restart.code === 0 ? "  gateway restarted" : `  restart failed:\n${restart.out}`);

  console.log("\nDone. Roster:");
  for (const agent of roster.agents) {
    console.log(`  ${agent.emoji}  ${agent.name.padEnd(8)} ${agent.role.padEnd(11)} ${agent.rationale}`);
  }
}

main().catch((error) => {
  console.error("\nProvisioning failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
