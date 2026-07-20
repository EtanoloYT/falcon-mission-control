import "server-only";

import { getDb } from "@/lib/db";
import { emitEvent, recordEvent } from "@/lib/events";
import { openclawAgentsList, type OpenclawAgentListEntry } from "@/lib/openclaw-cli";
import type { Agent } from "@/lib/schemas";
import { agentRoleSchema } from "@/lib/schemas";
import { createAgent, listAgentsFlat, updateAgent } from "@/lib/store";

export type ImportSummary = {
  imported: number;
  updated: number;
  skipped: number;
  details: Array<{ openclawId: string; name: string; action: "imported" | "updated" | "skipped"; reason?: string }>;
};

/**
 * Role inference heuristic — OpenClaw has no role concept, so we guess from
 * id/name keywords. Keep this in one place so it's easy to tune.
 *   - orchestrator / lead / ceo / main (default agent)  -> "ceo"
 *   - manager                                            -> "manager"
 *   - developer / coder / dev                             -> "coder"
 *   - reviewer / qa                                       -> "reviewer"
 *   - researcher / research                               -> "researcher"
 *   - tester / test / qa                                  -> "tester"
 *   - devops / infra / ops                                -> "devops"
 *   - anything else                                       -> "agent"
 */
export function inferRole(entry: OpenclawAgentListEntry): Agent["role"] {
  const haystack = `${entry.id} ${entry.name ?? ""}`.toLowerCase();

  if (entry.isDefault || /orchestrator|\blead\b|\bceo\b/.test(haystack)) {
    return "ceo";
  }
  if (/manager/.test(haystack)) {
    return "manager";
  }
  if (/reviewer/.test(haystack)) {
    return "reviewer";
  }
  if (/\btest(er)?\b|\bqa\b/.test(haystack)) {
    return "tester";
  }
  if (/research/.test(haystack)) {
    return "researcher";
  }
  if (/devops|infra|\bops\b/.test(haystack)) {
    return "devops";
  }
  if (/develop|coder|\bdev\b/.test(haystack)) {
    return "coder";
  }

  const parsed = agentRoleSchema.safeParse("agent");
  return parsed.success ? parsed.data : "agent";
}

function defaultSoulTemplate(entry: OpenclawAgentListEntry) {
  return `You are ${entry.name ?? entry.id}, an OpenClaw agent imported into Falcon Mission Control.

Rules:
- Keep task updates concise and actionable.
- Report progress back to Mission Control using the provided API key.
- Ask for clarification only when blocked.
- Prefer small, verifiable steps.
- Maintain professional, compact status updates.`;
}

function resolveName(entry: OpenclawAgentListEntry, taken: Set<string>) {
  const base = entry.name?.trim() || entry.id;
  if (!taken.has(base)) {
    return base;
  }

  const suffixed = `${base} (${entry.id})`;
  if (!taken.has(suffixed)) {
    return suffixed;
  }

  // Deterministic last-resort fallback.
  return `${base}-${entry.id}`;
}

/**
 * Idempotent sync: OpenClaw CLI -> Mission Control agents table.
 * Matches existing MC agents by config.openclawId. Re-running updates
 * in place rather than duplicating. Read-only toward OpenClaw itself —
 * never calls openclawAgentsAdd/openclawAgentsDelete.
 */
export async function importAgentsFromOpenclaw(options?: {
  allowedOpenclawIds?: ReadonlySet<string>;
}): Promise<ImportSummary> {
  const allEntries = await openclawAgentsList();
  const entries = options?.allowedOpenclawIds
    ? allEntries.filter((entry) => options.allowedOpenclawIds?.has(entry.id))
    : allEntries;

  const summary: ImportSummary = { imported: 0, updated: 0, skipped: 0, details: [] };

  const existing = listAgentsFlat();
  const byOpenclawId = new Map<string, Agent>();
  for (const agent of existing) {
    const id = (agent.config as { openclawId?: string | number } | undefined)?.openclawId;
    if (id !== undefined) {
      byOpenclawId.set(String(id), agent);
    }
  }

  const takenNames = new Set(existing.map((agent) => agent.name));

  for (const entry of entries) {
    if (!entry.id) {
      summary.skipped += 1;
      summary.details.push({ openclawId: "(unknown)", name: "(unknown)", action: "skipped", reason: "missing id" });
      continue;
    }

    const nextConfig: Record<string, unknown> = {
      openclawId: entry.id,
      model: entry.model,
      workspace: entry.workspace,
      agentDir: entry.agentDir,
      isDefault: entry.isDefault ?? false,
      identityEmoji: entry.identityEmoji,
    };

    const matched = byOpenclawId.get(entry.id);

    if (matched) {
      const result = getDb().transaction(() => {
        const agent = updateAgent(matched.id, {
          config: { ...matched.config, ...nextConfig },
        });
        if (!agent) {
          throw new Error(`Agent ${matched.id} disappeared during import`);
        }
        return recordEvent({ kind: "agent.updated", payload: { agent } }, false);
      })();
      emitEvent(result);

      summary.updated += 1;
      summary.details.push({ openclawId: entry.id, name: matched.name, action: "updated" });
      continue;
    }

    const name = resolveName(entry, takenNames);
    takenNames.add(name);
    const role = inferRole(entry);

    const { created, event } = getDb().transaction(() => {
      const c = createAgent({
        name,
        role,
        parent_id: null,
        soul: defaultSoulTemplate(entry),
        config: nextConfig,
      });
      const e = recordEvent({ kind: "agent.created", payload: { agent: c.agent } }, false);
      return { created: c, event: e };
    })();
    emitEvent(event);

    byOpenclawId.set(entry.id, created.agent);
    summary.imported += 1;
    summary.details.push({ openclawId: entry.id, name, action: "imported" });
  }

  return summary;
}
