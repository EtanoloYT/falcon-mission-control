import "server-only";

import crypto from "node:crypto";

import { getDb, now, type TaskRow } from "@/lib/db";
import { emitEvent, recordEvent } from "@/lib/events";
import { openclawAgentRun } from "@/lib/openclaw-cli";
import type { Agent, Event, Project, Task } from "@/lib/schemas";
import {
  addTaskComment,
  completeTask,
  createTask,
  getAgent,
  getProject,
  getProjectCeo,
  getTask,
  listAgentsFlat,
  updateAgent,
  updateTask,
} from "@/lib/store";

type DispatchOutcome = {
  queued: boolean;
  alreadyQueued?: boolean;
  agentId?: number;
  openclawId?: string;
  sessionKey?: string;
  reason?: string;
};

type DispatcherState = {
  queue: Promise<void>;
  taskSessions: Map<number, string>;
  wakeAgentIds: Set<number>;
  recoveryStarted: boolean;
};

const globalState = globalThis as typeof globalThis & {
  falconDispatcher?: DispatcherState;
};

function dispatcherState() {
  if (!globalState.falconDispatcher) {
    globalState.falconDispatcher = {
      queue: Promise.resolve(),
      taskSessions: new Map<number, string>(),
      wakeAgentIds: new Set<number>(),
      recoveryStarted: false,
    };
  }

  return globalState.falconDispatcher;
}

function enqueue(job: () => Promise<void>) {
  const state = dispatcherState();
  const next = state.queue.catch(() => undefined).then(job);
  state.queue = next.catch((error) => {
    console.error("[falcon-mission-control] OpenClaw dispatch job failed", error);
  });
  return next;
}

function emitAll(events: Event[]) {
  events.forEach(emitEvent);
}

function openclawIdForAgent(agent: Agent) {
  const value = (agent.config as { openclawId?: string | number } | undefined)?.openclawId;
  return value === undefined || value === null ? null : String(value).trim() || null;
}

function taskTimeoutSeconds() {
  const configured = Number(process.env.OPENCLAW_TASK_TIMEOUT_SECONDS ?? 900);
  if (!Number.isFinite(configured)) return 900;
  return Math.max(60, Math.min(3600, Math.round(configured)));
}

export function buildTaskPrompt(input: {
  task: Task;
  project: Project;
  agent: Agent;
  roster: Agent[];
}) {
  const roster = input.roster
    .map((entry) => `- ID ${entry.id}: ${entry.name} (${entry.role}, OpenClaw ${openclawIdForAgent(entry) ?? "not linked"})`)
    .join("\n");
  return [
    "You have been woken by Falcon Mission Control to execute a real task.",
    "",
    `Mission Control task: #${input.task.id}`,
    `Project: ${input.project.name}`,
    `Project description: ${input.project.description || "(none)"}`,
    `Assigned agent: ${input.agent.name} (${input.agent.role})`,
    `Priority: ${input.task.priority}`,
    `Title: ${input.task.title}`,
    `Description: ${input.task.description || "(none)"}`,
    "",
    "Execution contract:",
    "- Work on the task now using your available tools; do not stop after merely proposing a plan.",
    "- Respect paths, constraints, and acceptance criteria in the project/task description.",
    "- Delegate only when that materially improves the result and the delegated agent has the needed tools.",
    "- Mission Control tracks this run's final response automatically.",
    "- Finish with a concise report of what changed, verification performed, and any remaining blocker.",
    "",
    "Mission Control delegation:",
    "- You cannot call Mission Control directly. Mission Control will materialize subtasks from your final response.",
    "- If this task asks you to create, assign, or delegate work, a prose plan alone is not completion.",
    `- Available agents:\n${roster}`,
    "- End your final response with exactly one <mission_control_subtasks> block containing a JSON array.",
    '- Every array item must be: {"title":"...","description":"...","priority":"low|normal|high|urgent","assigned_agent_id":NUMBER}.',
    "- Use only agent IDs from the roster. Do not include project_id or parent_task_id; Mission Control supplies them safely.",
    "- Example: <mission_control_subtasks>[{\"title\":\"Implement API\",\"description\":\"Build and verify the API.\",\"priority\":\"high\",\"assigned_agent_id\":3}]</mission_control_subtasks>",
    "- If no subtasks are needed, omit the block. Mission Control automatically queues every valid item.",
  ].join("\n");
}

export type ProposedSubtask = {
  title: string;
  description: string;
  priority: Task["priority"];
  assigned_agent_id: number;
};

export function parseProposedSubtasks(text: string) {
  const match = text.match(/<mission_control_subtasks>\s*([\s\S]*?)\s*<\/mission_control_subtasks>/i);
  if (!match) return { cleanText: text.trim(), subtasks: [] as ProposedSubtask[] };

  const cleanText = text.replace(match[0], "").trim();
  let raw: unknown;
  try {
    raw = JSON.parse(match[1].replace(/^```(?:json)?\s*|\s*```$/gi, "").trim());
  } catch {
    return { cleanText, subtasks: [] as ProposedSubtask[] };
  }

  if (!Array.isArray(raw)) return { cleanText, subtasks: [] as ProposedSubtask[] };
  const priorities = new Set<Task["priority"]>(["low", "normal", "high", "urgent"]);
  const subtasks = raw.slice(0, 20).flatMap((entry): ProposedSubtask[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title.trim().slice(0, 300) : "";
    const description = typeof item.description === "string" ? item.description.slice(0, 30_000) : "";
    const priority = typeof item.priority === "string" ? item.priority : "normal";
    const assignedAgentId = Number(item.assigned_agent_id);
    if (!title || !priorities.has(priority as Task["priority"]) || !Number.isSafeInteger(assignedAgentId) || assignedAgentId <= 0) {
      return [];
    }
    return [{ title, description, priority: priority as Task["priority"], assigned_agent_id: assignedAgentId }];
  });

  return { cleanText, subtasks };
}

function materializeSubtasks(parent: Task, proposals: ProposedSubtask[]) {
  const valid = proposals.filter((proposal) => Boolean(getAgent(proposal.assigned_agent_id)));
  const { taskIds, events } = getDb().transaction(() => {
    const ids: number[] = [];
    const createdEvents: Event[] = [];
    for (const proposal of valid) {
      const duplicate = getDb()
        .prepare("SELECT id FROM tasks WHERE parent_task_id = ? AND lower(title) = lower(?) LIMIT 1")
        .get(parent.id, proposal.title) as { id: number } | undefined;
      if (duplicate) {
        ids.push(duplicate.id);
        continue;
      }

      const task = createTask({
        project_id: parent.project_id,
        parent_task_id: parent.id,
        title: proposal.title,
        description: proposal.description,
        priority: proposal.priority,
        assigned_agent_id: proposal.assigned_agent_id,
        created_by_agent_id: parent.assigned_agent_id,
      });
      if (!task) continue;
      ids.push(task.id);
      createdEvents.push(recordEvent({ kind: "task.created", payload: { task } }, false));
    }
    return { taskIds: ids, events: createdEvents };
  })();

  emitAll(events);
  taskIds.forEach((taskId) => enqueueTaskDispatch({ taskId }));
  return { total: taskIds.length, created: events.length };
}

function markTaskQueued(task: Task, agentId: number) {
  if (task.assigned_agent_id === agentId && task.status === "assigned") {
    return;
  }

  const event = getDb().transaction(() => {
    const updated = updateTask(task.id, {
      assigned_agent_id: agentId,
      status: task.status === "in_progress" ? "in_progress" : "assigned",
    });
    if (!updated) throw new Error("Task disappeared while queueing dispatch");
    return recordEvent({ kind: "task.updated", payload: { task: updated } }, false);
  })();
  emitEvent(event);
}

function markRunStarted(taskId: number, agentId: number) {
  const events = getDb().transaction(() => {
    const task = updateTask(taskId, { assigned_agent_id: agentId, status: "in_progress" });
    const agent = updateAgent(agentId, { status: "busy", last_seen: now() });
    const next: Event[] = [];
    if (task) next.push(recordEvent({ kind: "task.updated", payload: { task } }, false));
    if (agent) next.push(recordEvent({ kind: "agent.status", payload: { agent } }, false));
    return next;
  })();
  emitAll(events);
}

function markRunCompleted(taskId: number, agentId: number, result: string) {
  const events = getDb().transaction(() => {
    const task = completeTask(taskId, result);
    const agent = updateAgent(agentId, { status: "idle", last_seen: now() });
    const next: Event[] = [];
    if (task) next.push(recordEvent({ kind: "task.updated", payload: { task } }, false));
    if (agent) next.push(recordEvent({ kind: "agent.status", payload: { agent } }, false));
    return next;
  })();
  emitAll(events);
}

function markRunFailed(taskId: number, agentId: number, error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  const events = getDb().transaction(() => {
    const task = updateTask(taskId, { status: "failed" });
    const agent = updateAgent(agentId, { status: "error", last_seen: now() });
    const comment = getTask(taskId)
      ? addTaskComment({
          task_id: taskId,
          author_kind: "system",
          body: `OpenClaw dispatch failed: ${message}`,
        })
      : null;
    const next: Event[] = [];
    if (task) next.push(recordEvent({ kind: "task.updated", payload: { task } }, false));
    if (agent) next.push(recordEvent({ kind: "agent.status", payload: { agent } }, false));
    if (comment) {
      next.push(recordEvent({ kind: "task.comment", payload: { task_id: taskId, comment } }, false));
    }
    return next;
  })();
  emitAll(events);
}

async function executeTask(taskId: number, agentId: number, openclawId: string, sessionKey: string) {
  const task = getTask(taskId);
  const agent = getAgent(agentId);
  const project = task ? getProject(task.project_id) : null;
  if (!task || !agent || !project) {
    throw new Error("Task, agent, or project disappeared before dispatch");
  }

  markRunStarted(taskId, agentId);
  try {
    const run = await openclawAgentRun({
      agentId: openclawId,
      sessionKey,
      message: buildTaskPrompt({
        task,
        project,
        agent,
        roster: listAgentsFlat(),
      }),
      thinking: "low",
      timeoutSeconds: taskTimeoutSeconds(),
    });
    const proposal = parseProposedSubtasks(run.text);
    const materialized = materializeSubtasks(task, proposal.subtasks);
    const result = materialized.total
      ? `${proposal.cleanText}\n\nMission Control materialized ${materialized.total} subtask(s) (${materialized.created} new) and queued their assignees.`
      : proposal.cleanText;
    markRunCompleted(taskId, agentId, result);
  } catch (error) {
    markRunFailed(taskId, agentId, error);
  }
}

export function enqueueTaskDispatch(input: { taskId: number; agentId?: number | null }): DispatchOutcome {
  const task = getTask(input.taskId);
  if (!task) {
    return { queued: false, reason: "Task not found" };
  }
  if (["done", "review"].includes(task.status)) {
    return { queued: false, reason: `Task is already ${task.status}` };
  }

  const agent = input.agentId ? getAgent(input.agentId) : task.assigned_agent_id ? getAgent(task.assigned_agent_id) : getProjectCeo(task.project_id);
  if (!agent) {
    return { queued: false, reason: "No assigned agent or CEO/orchestrator is available" };
  }

  const openclawId = openclawIdForAgent(agent);
  if (!openclawId) {
    return { queued: false, agentId: agent.id, reason: `Agent ${agent.name} is not linked to an OpenClaw agent` };
  }

  const state = dispatcherState();
  const activeSessionKey = state.taskSessions.get(task.id);
  if (activeSessionKey) {
    return { queued: true, alreadyQueued: true, agentId: agent.id, openclawId, sessionKey: activeSessionKey };
  }
  const sessionKey = `agent:${openclawId}:mission-control-task-${task.id}-${crypto.randomUUID()}`;

  markTaskQueued(task, agent.id);
  state.taskSessions.set(task.id, sessionKey);
  void enqueue(() => executeTask(task.id, agent.id, openclawId, sessionKey))
    .finally(() => {
      state.taskSessions.delete(task.id);
    })
    .catch(() => undefined);

  return { queued: true, agentId: agent.id, openclawId, sessionKey };
}

function markAgentActivity(agentId: number, status: Agent["status"]) {
  const event = getDb().transaction(() => {
    const agent = updateAgent(agentId, { status, last_seen: now() });
    if (!agent) throw new Error("Agent disappeared while waking");
    return recordEvent({ kind: "agent.status", payload: { agent } }, false);
  })();
  emitEvent(event);
}

export function enqueueAgentWake(agentId: number): DispatchOutcome {
  const pending = getDb()
    .prepare(
      `SELECT * FROM tasks
       WHERE assigned_agent_id = ? AND status IN ('assigned', 'backlog')
       ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                created_at ASC
       LIMIT 1`
    )
    .get(agentId) as TaskRow | undefined;

  if (pending) {
    return enqueueTaskDispatch({ taskId: pending.id, agentId });
  }

  const agent = getAgent(agentId);
  if (!agent) return { queued: false, reason: "Agent not found" };
  const openclawId = openclawIdForAgent(agent);
  if (!openclawId) {
    return { queued: false, agentId, reason: `Agent ${agent.name} is not linked to an OpenClaw agent` };
  }

  const state = dispatcherState();
  if (state.wakeAgentIds.has(agentId)) {
    return { queued: true, alreadyQueued: true, agentId, openclawId };
  }

  state.wakeAgentIds.add(agentId);
  void enqueue(async () => {
    markAgentActivity(agentId, "busy");
    try {
      await openclawAgentRun({
        agentId: openclawId,
        sessionKey: `agent:${openclawId}:mission-control-wake`,
        message:
          "Falcon Mission Control has manually woken you. Confirm readiness in one short sentence and report only a real blocker, if one exists. Do not perform unrelated work.",
        thinking: "off",
        timeoutSeconds: 120,
      });
      markAgentActivity(agentId, "idle");
    } catch (error) {
      console.error(`[falcon-mission-control] Failed to wake OpenClaw agent ${openclawId}`, error);
      markAgentActivity(agentId, "error");
    }
  })
    .finally(() => {
      state.wakeAgentIds.delete(agentId);
    })
    .catch(() => undefined);

  return { queued: true, agentId, openclawId, sessionKey: `agent:${openclawId}:mission-control-wake` };
}

/** Re-queues durable assigned work once after a Mission Control process restart. */
export function ensureDispatchRecovery() {
  const state = dispatcherState();
  if (state.recoveryStarted) return;
  state.recoveryStarted = true;

  const rows = getDb()
    .prepare("SELECT * FROM tasks WHERE status = 'assigned' AND assigned_agent_id IS NOT NULL ORDER BY created_at ASC")
    .all() as TaskRow[];

  for (const row of rows) {
    enqueueTaskDispatch({ taskId: row.id, agentId: row.assigned_agent_id });
  }
}
