"use client";

import { useState } from "react";

import {
  Activity,
  Bot,
  ChevronRight,
  CircleDot,
  FolderKanban,
  FolderMinus,
  FolderPlus,
  MessageSquare,
  PlusCircle,
  Radio,
  RefreshCw,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { Event } from "@/lib/schemas";

type Kind = Event["kind"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** Best-effort, never-throw pull of nested fields out of an unknown payload. */
function get(payload: unknown, path: string[]): unknown {
  let current: unknown = payload;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

type Tone = "task" | "agent" | "project" | "system" | "danger";

const TONE_CLASSES: Record<Tone, { icon: string; dot: string; ring: string }> = {
  task: { icon: "text-sky-300", dot: "bg-sky-400", ring: "border-sky-900/60 bg-sky-500/10" },
  agent: { icon: "text-amber-300", dot: "bg-amber-400", ring: "border-amber-900/60 bg-amber-500/10" },
  project: { icon: "text-violet-300", dot: "bg-violet-400", ring: "border-violet-900/60 bg-violet-500/10" },
  system: { icon: "text-zinc-400", dot: "bg-zinc-500", ring: "border-zinc-800 bg-zinc-900" },
  danger: { icon: "text-rose-300", dot: "bg-rose-400", ring: "border-rose-900/60 bg-rose-500/10" },
};

type EventMeta = {
  icon: typeof Activity;
  tone: Tone;
  summary: string;
};

function describeEvent(kind: Kind, payload: unknown): EventMeta {
  switch (kind) {
    case "task.created": {
      const title = str(get(payload, ["task", "title"])) ?? `#${num(get(payload, ["task", "id"])) ?? "?"}`;
      const projectId = num(get(payload, ["task", "project_id"]));
      return {
        icon: PlusCircle,
        tone: "task",
        summary: `Task "${title}" created${projectId !== undefined ? ` in project #${projectId}` : ""}`,
      };
    }
    case "task.updated": {
      const title = str(get(payload, ["task", "title"])) ?? `#${num(get(payload, ["task", "id"])) ?? "?"}`;
      const status = str(get(payload, ["task", "status"]));
      return {
        icon: RefreshCw,
        tone: "task",
        summary: status ? `Task "${title}" moved to ${status.replace("_", " ")}` : `Task "${title}" updated`,
      };
    }
    case "task.deleted": {
      const taskId = num(get(payload, ["task_id"]));
      return {
        icon: Trash2,
        tone: "danger",
        summary: `Task ${taskId !== undefined ? `#${taskId} ` : ""}deleted`,
      };
    }
    case "task.comment": {
      const body = str(get(payload, ["comment", "body"]));
      const authorKind = str(get(payload, ["comment", "author_kind"]));
      const taskId = num(get(payload, ["task_id"]));
      const who = authorKind === "agent" ? "An agent" : authorKind === "system" ? "System" : "Someone";
      const target = taskId !== undefined ? `task #${taskId}` : "a task";
      return {
        icon: MessageSquare,
        tone: "task",
        summary: body ? `${who} commented on ${target}: "${truncate(body, 80)}"` : `${who} commented on ${target}`,
      };
    }
    case "agent.status": {
      const name = str(get(payload, ["agent", "name"])) ?? "An agent";
      const status = str(get(payload, ["agent", "status"]));
      return {
        icon: CircleDot,
        tone: status === "error" ? "danger" : "agent",
        summary: status ? `${name} went ${status}` : `${name} status changed`,
      };
    }
    case "agent.created": {
      const name = str(get(payload, ["agent", "name"])) ?? "Agent";
      const role = str(get(payload, ["agent", "role"]));
      return {
        icon: UserPlus,
        tone: "agent",
        summary: role ? `${name} joined as ${role}` : `${name} was created`,
      };
    }
    case "agent.updated": {
      const name = str(get(payload, ["agent", "name"])) ?? "An agent";
      return { icon: RefreshCw, tone: "agent", summary: `${name} was updated` };
    }
    case "agent.deleted": {
      const agentId = num(get(payload, ["agent_id"]));
      return {
        icon: UserMinus,
        tone: "danger",
        summary: `Agent ${agentId !== undefined ? `#${agentId} ` : ""}deleted`,
      };
    }
    case "project.created": {
      const name = str(get(payload, ["project", "name"])) ?? "A project";
      return { icon: FolderPlus, tone: "project", summary: `Project "${name}" created` };
    }
    case "project.updated": {
      const name = str(get(payload, ["project", "name"])) ?? "A project";
      const status = str(get(payload, ["project", "status"]));
      return {
        icon: FolderKanban,
        tone: "project",
        summary: status ? `Project "${name}" updated (${status})` : `Project "${name}" updated`,
      };
    }
    case "project.deleted": {
      const projectId = num(get(payload, ["project_id"]));
      return {
        icon: FolderMinus,
        tone: "danger",
        summary: `Project ${projectId !== undefined ? `#${projectId} ` : ""}deleted`,
      };
    }
    case "gateway.status": {
      const reachable = get(payload, ["reachable"]);
      return {
        icon: Radio,
        tone: reachable === false ? "danger" : "system",
        summary: reachable === false ? "Gateway went unreachable" : reachable === true ? "Gateway is reachable" : "Gateway status changed",
      };
    }
    case "heartbeat": {
      const name = str(get(payload, ["agent", "name"])) ?? "An agent";
      return { icon: Activity, tone: "system", summary: `${name} checked in` };
    }
    default: {
      return { icon: Bot, tone: "system", summary: `${String(kind)} event` };
    }
  }
}

function truncate(value: string, max: number) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

function relativeTime(ts: number) {
  const diffMs = Date.now() - ts;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export function eventSearchText(event: Event) {
  const meta = describeEvent(event.kind, event.payload);
  let payloadJson = "";
  try {
    payloadJson = JSON.stringify(event.payload);
  } catch {
    payloadJson = "";
  }
  return `${meta.summary} ${event.kind} ${payloadJson}`.toLowerCase();
}

export function EventRow({ event, compact = false }: { event: Event; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const meta = describeEvent(event.kind, event.payload);
  const Icon = meta.icon;
  const tone = TONE_CLASSES[meta.tone];
  const absolute = new Date(event.ts).toLocaleString();

  let pretty = "";
  try {
    pretty = JSON.stringify(event.payload, null, 2);
  } catch {
    pretty = "Unable to render payload.";
  }

  return (
    <div className={cn("min-w-0 rounded-lg border border-zinc-900 bg-zinc-950", compact ? "px-2.5 py-2" : "px-3 py-2.5")}>
      <div className="flex min-w-0 items-start gap-2.5">
        <span className={cn("mt-0.5 flex shrink-0 items-center justify-center rounded-md border", tone.ring, compact ? "h-6 w-6" : "h-7 w-7")}>
          <Icon className={cn(tone.icon, compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className={cn("block min-w-0 flex-1 truncate text-zinc-100", compact ? "text-xs" : "text-sm")}>{meta.summary}</span>
            <span
              className="shrink-0 whitespace-nowrap text-[11px] text-zinc-500"
              title={absolute}
            >
              {relativeTime(event.ts)}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className={cn("inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-500")}>
              <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
              {event.kind}
            </span>
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="inline-flex items-center gap-0.5 text-[11px] text-zinc-500 transition-colors hover:text-amber-400"
            >
              <ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
              {expanded ? "Hide payload" : "Raw payload"}
            </button>
          </div>
          {expanded ? (
            <div className="mt-2 max-w-full overflow-x-auto rounded-md border border-zinc-800 bg-black/40 p-2">
              <pre className="w-max min-w-full text-[11px] leading-5 text-zinc-400">{pretty}</pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
