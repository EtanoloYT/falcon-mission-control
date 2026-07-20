import "server-only";

import { getDb, now, type TaskRow } from "@/lib/db";
import { emitEvent, recordEvent } from "@/lib/events";
import { openclawAgentRun } from "@/lib/openclaw-cli";
import type { Agent, Event, Project, Task } from "@/lib/schemas";
import { issueTaskToken } from "@/lib/task-token";
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
  reason?: string;
};

type DispatcherState = {
  /** Serialize work per agent, not globally: one stuck specialist must not stop the whole team. */
  queues: Map<number, Promise<void>>;
  /** Task ids with a run queued or in flight, so a re-assign does not double-dispatch. */
  inFlightTaskIds: Set<number>;
  wakeAgentIds: Set<number>;
  recoveryStarted: boolean;
};

const globalState = globalThis as typeof globalThis & {
  falconDispatcher?: DispatcherState;
};

function dispatcherState() {
  if (!globalState.falconDispatcher) {
    globalState.falconDispatcher = {
      queues: new Map(),
      inFlightTaskIds: new Set<number>(),
      wakeAgentIds: new Set<number>(),
      recoveryStarted: false,
    };
  }

  // Survive Next.js hot reloads from the older single-queue state shape.
  if (!globalState.falconDispatcher.queues) {
    globalState.falconDispatcher.queues = new Map();
  }

  return globalState.falconDispatcher;
}

function enqueue(agentId: number, job: () => Promise<void>) {
  const state = dispatcherState();
  const current = state.queues.get(agentId) ?? Promise.resolve();
  const next = current.catch(() => undefined).then(job);
  const tracked = next.catch((error) => {
    console.error("[falcon-mission-control] OpenClaw dispatch job failed", error);
  });
  state.queues.set(agentId, tracked);
  void tracked.finally(() => {
    if (state.queues.get(agentId) === tracked) state.queues.delete(agentId);
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
  const configured = Number(process.env.OPENCLAW_TASK_TIMEOUT_SECONDS ?? 300);
  if (!Number.isFinite(configured)) return 300;
  return Math.max(60, Math.min(3600, Math.round(configured)));
}

const MAX_PROMPT_FIELD_CHARS = 6_000;

function boundedPromptField(value: string | null | undefined, fallback = "(none)") {
  const text = value?.trim() || fallback;
  if (text.length <= MAX_PROMPT_FIELD_CHARS) return text;
  return `${text.slice(0, MAX_PROMPT_FIELD_CHARS)}\n[truncated by Mission Control]`;
}

export function buildTaskPrompt(input: {
  task: Task;
  project: Project;
  agent: Agent;
  roster: Agent[];
  /** Per-task capability token; the agent's only proof of identity to the shared MCP server. */
  workToken: string;
}) {
  const roster = input.roster
    .map((entry) => `- ID ${entry.id}: ${entry.name} (${entry.role}, OpenClaw ${openclawIdForAgent(entry) ?? "not linked"})`)
    .join("\n");
  return [
    "You have been woken by Falcon Mission Control to execute a real task.",
    "",
    `Mission Control task: #${input.task.id}`,
    `Project: ${input.project.name}`,
    `Project description: ${boundedPromptField(input.project.description)}`,
    `Assigned agent: ${input.agent.name} (${input.agent.role})`,
    input.project.target_folder === "AUTO"
      ? "Working directory: AUTO — no directory restriction."
      : `Working directory: ${input.project.target_folder}\n- Create and modify files only under this directory, using absolute paths.`,
    `Priority: ${input.task.priority}`,
    `Title: ${boundedPromptField(input.task.title)}`,
    `Description: ${boundedPromptField(input.task.description)}`,
    "",
    "Execution contract:",
    "- Work on the task now using your available tools; do not stop after merely proposing a plan.",
    "- Respect paths, constraints, and acceptance criteria in the project/task description.",
    "- Delegate only when that materially improves the result and the delegated agent has the needed tools.",
    "- Report progress on longer work with falconmc__mc_comment_task.",
    "- Finish with a concise report of what changed, verification performed, and any remaining blocker.",
    ...(input.agent.role === "coder"
      ? [
          "- CODER RULE: Make no more than 3 read/exec inspection calls before your first write or edit call.",
          "- Missing implementation files are expected: create them immediately instead of repeatedly searching for them.",
          "- Do not delegate, redesign the plan, or keep grepping once the required missing file is known.",
        ]
      : []),
    "",
    "Mission Control tools:",
    "- You have falconmc__mc_* tools that talk to Mission Control directly. Use their exact names and prefer them over describing what you would do.",
    `- Every falconmc__mc_* tool needs work_token. Yours is: ${input.workToken}`,
    "- Pass that work_token string exactly as-is. It identifies you and your task, so no tool needs your agent id or task id.",
    "- falconmc__mc_list_agents gives you real integer agent ids for delegation.",
    "- Delegated subtasks run after your turn ends. Do not wait for their results.",
    `- Available agents:\n${roster}`,
    "",
    "If this task asks you to create, assign, plan or delegate work:",
    "- A prose plan alone is not completion. The work only counts once falconmc__mc_delegate has been called.",
    "- Call falconmc__mc_delegate once per subtask, back to back, before you write any prose.",
    "- Cover the whole job: keep calling falconmc__mc_delegate until every part of it is assigned to someone.",
    "- Do not stop after the first subtask. One falconmc__mc_delegate call is almost never a complete plan.",
    "- Give each subtask a description someone could act on without seeing this task.",
    "- Only after the last falconmc__mc_delegate call, write a short report listing what you delegated and to whom.",
    "",
    "Fallback (only if your falconmc__mc_delegate calls fail):",
    "- End your final response with exactly one <mission_control_subtasks> block containing a JSON array.",
    '- Every array item must be: {"title":"...","description":"...","priority":"low|normal|high|urgent","assigned_agent_id":NUMBER}.',
    "- Use only agent IDs from the roster. Do not include project_id or parent_task_id; Mission Control supplies them safely.",
    "- Mission Control ignores duplicates, so a subtask you already created with falconmc__mc_delegate will not be created twice.",
  ].join("\n");
}

export type ProposedSubtask = {
  title: string;
  description: string;
  priority: Task["priority"];
  assigned_agent_id: number;
};

function decodeJsonString(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Some small local models choose the correct tool and arguments but flatten
 * the call into text. Recover only the strict, task-token-anchored shape so
 * arbitrary prose can never create work accidentally.
 */
export function parseFlattenedDelegations(text: string, workToken: string) {
  const escapedToken = workToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const jsonString = '"(?:[^"\\\\]|\\\\.)*"';
  const pattern = new RegExp(
    `${escapedToken}\\s+(\\d+)\\s+(${jsonString})\\s+(${jsonString})\\s+(low|normal|high|urgent)\\b`,
    "gi"
  );
  const seen = new Set<string>();
  const subtasks: ProposedSubtask[] = [];
  for (const match of text.matchAll(pattern)) {
    const assignedAgentId = Number(match[1]);
    const title = decodeJsonString(match[2])?.trim().slice(0, 300) ?? "";
    const description = decodeJsonString(match[3])?.slice(0, 30_000) ?? "";
    const priority = match[4].toLowerCase() as Task["priority"];
    const key = `${assignedAgentId}:${title.toLowerCase()}`;
    if (!Number.isSafeInteger(assignedAgentId) || assignedAgentId <= 0 || !title || seen.has(key)) continue;
    seen.add(key);
    subtasks.push({ title, description, priority, assigned_agent_id: assignedAgentId });
    if (subtasks.length === 20) break;
  }
  return subtasks;
}

export function parseProposedSubtasks(text: string, workToken?: string) {
  const match = text.match(/<mission_control_subtasks>\s*([\s\S]*?)\s*<\/mission_control_subtasks>/i);
  if (!match) {
    return {
      cleanText: text.trim(),
      subtasks: workToken ? parseFlattenedDelegations(text, workToken) : [],
    };
  }

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
    let duplicates = 0;
    for (const proposal of valid) {
      const duplicate = getDb()
        .prepare("SELECT id FROM tasks WHERE parent_task_id = ? AND lower(title) = lower(?) LIMIT 1")
        .get(parent.id, proposal.title) as { id: number } | undefined;
      if (duplicate) {
        // Already materialized by an earlier run — do not re-dispatch it, or a
        // re-run of the parent restarts children that are running or finished.
        duplicates += 1;
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
    return { taskIds: ids, events: createdEvents, duplicates };
  })();

  emitAll(events);
  taskIds.forEach((taskId) => enqueueTaskDispatch({ taskId }));
  return { total: taskIds.length, created: taskIds.length };
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

async function executeTask(taskId: number, agentId: number, openclawId: string) {
  const task = getTask(taskId);
  const agent = getAgent(agentId);
  const project = task ? getProject(task.project_id) : null;
  if (!task || !agent || !project) {
    throw new Error("Task, agent, or project disappeared before dispatch");
  }
  // A user can cancel a task while it waits behind another agent in the
  // serialized queue. Re-read state at execution time and honor terminal
  // status instead of resurrecting cancelled/finished work.
  if (["done", "review", "failed"].includes(task.status)) {
    return;
  }

  markRunStarted(taskId, agentId);
  try {
    const workToken = issueTaskToken({ taskId: task.id, agentId: agent.id });
    // Every attempt gets a fresh transcript. A timed-out embedded run may stay
    // active briefly inside OpenClaw; unique keys let recovery proceed without
    // racing or mutating that predecessor.
    const sessionKey = `agent:${openclawId}:mc-task-${task.id}-${Date.now()}`;
    const run = await openclawAgentRun({
      agentId: openclawId,
      sessionKey,
      message: buildTaskPrompt({
        task,
        project,
        agent,
        roster: listAgentsFlat(),
        workToken,
      }),
      // Local reasoning models can spend minutes thinking before their first
      // tool call. The dispatch prompt already supplies a strict execution
      // contract, so minimal reasoning is the better reliability/latency
      // tradeoff here.
        thinking: "off",
      timeoutSeconds: taskTimeoutSeconds(),
    });
    const proposal = parseProposedSubtasks(run.text, workToken);
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
  if (["done", "review", "failed"].includes(task.status)) {
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
  if (state.inFlightTaskIds.has(task.id)) {
    return { queued: true, alreadyQueued: true, agentId: agent.id, openclawId };
  }

  markTaskQueued(task, agent.id);
  state.inFlightTaskIds.add(task.id);
  void enqueue(agent.id, () => executeTask(task.id, agent.id, openclawId))
    .finally(() => {
      state.inFlightTaskIds.delete(task.id);
    })
    .catch(() => undefined);

  return { queued: true, agentId: agent.id, openclawId };
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
  void enqueue(agentId, async () => {
    markAgentActivity(agentId, "busy");
    try {
      await openclawAgentRun({
        agentId: openclawId,
        sessionKey: `agent:${openclawId}:mc-wake`,
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

  return { queued: true, agentId, openclawId };
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
