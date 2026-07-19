import "server-only";

import { getDb, generateApiKey, mapAgent, mapProject, mapTask, mapTaskComment, now, parseJson, sha256, stringifyJson, type AgentRow, type ProjectRow, type TaskCommentRow, type TaskRow } from "@/lib/db";
import type { Agent, AgentTree, Project, Task, TaskComment } from "@/lib/schemas";

function buildAgentTree(agents: Agent[]) {
  const byId = new Map<number, AgentTree>();
  const roots: AgentTree[] = [];

  for (const agent of agents) {
    byId.set(agent.id, { ...agent, children: [] });
  }

  for (const agent of byId.values()) {
    if (agent.parent_id && byId.has(agent.parent_id)) {
      byId.get(agent.parent_id)?.children.push(agent);
    } else {
      roots.push(agent);
    }
  }

  // Defensive: any agent not reachable from a root (e.g. because of a
  // pre-existing cycle in the data) must still be surfaced somewhere,
  // otherwise it silently vanishes from the UI while remaining in the DB.
  const reachable = new Set<number>();
  const visit = (node: AgentTree) => {
    reachable.add(node.id);
    node.children.forEach(visit);
  };
  roots.forEach(visit);

  for (const agent of byId.values()) {
    if (!reachable.has(agent.id)) {
      roots.push(agent);
      reachable.add(agent.id);
    }
  }

  const sortTree = (nodes: AgentTree[]) => {
    nodes.sort((left, right) => left.id - right.id || left.name.localeCompare(right.name));
    nodes.forEach((node) => sortTree(node.children));
  };

  sortTree(roots);
  return roots;
}

export function listProjects() {
  const rows = getDb().prepare("SELECT * FROM projects ORDER BY created_at DESC, id DESC").all() as ProjectRow[];
  return rows.map(mapProject);
}

export function getProject(id: number) {
  const row = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  return row ? mapProject(row) : null;
}

export function createProject(input: { name: string; description: string }) {
  const db = getDb();
  const timestamp = now();
  const result = db
    .prepare("INSERT INTO projects (name, description, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)")
    .run(input.name, input.description, timestamp, timestamp);
  const project = getProject(Number(result.lastInsertRowid));
  return project;
}

export function updateProject(id: number, input: Partial<Pick<Project, "name" | "description" | "status">>) {
  const db = getDb();
  const existing = getProject(id);
  if (!existing) {
    return null;
  }

  const next = {
    name: input.name ?? existing.name,
    description: input.description ?? existing.description,
    status: input.status ?? existing.status,
  };

  db.prepare("UPDATE projects SET name = ?, description = ?, status = ?, updated_at = ? WHERE id = ?").run(
    next.name,
    next.description,
    next.status,
    now(),
    id
  );

  return getProject(id);
}

export function deleteProject(id: number) {
  const project = getProject(id);
  if (!project) {
    return false;
  }

  getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
  return true;
}

export function listAgentsFlat() {
  const rows = getDb().prepare("SELECT * FROM agents ORDER BY id ASC").all() as AgentRow[];
  return rows.map(mapAgent);
}

export function getAgent(id: number) {
  const row = getDb().prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
  return row ? mapAgent(row) : null;
}

export function listAgentsTree() {
  return buildAgentTree(listAgentsFlat());
}

export function createAgent(input: {
  name: string;
  role: Agent["role"];
  parent_id?: number | null;
  soul?: string;
  config?: Record<string, unknown>;
}) {
  const db = getDb();
  const timestamp = now();
  const apiKey = generateApiKey();
  const hashedApiKey = sha256(apiKey);
  const result = db
    .prepare(
      "INSERT INTO agents (name, role, parent_id, status, soul, config_json, last_seen, created_at, api_key) VALUES (?, ?, ?, 'offline', ?, ?, NULL, ?, ?)"
    )
    .run(
      input.name,
      input.role,
      input.parent_id ?? null,
      input.soul ?? "",
      stringifyJson(input.config ?? {}),
      timestamp,
      hashedApiKey
    );

  const inserted = getDb().prepare("SELECT * FROM agents WHERE id = ?").get(Number(result.lastInsertRowid)) as AgentRow | undefined;
  if (!inserted) {
    throw new Error("Failed to create agent");
  }

  db.prepare("UPDATE agents SET api_key = ? WHERE id = ?").run(apiKey ? require("@/lib/db").sha256(apiKey) : "", inserted.id);

  const created = getAgent(inserted.id);
  if (!created) {
    throw new Error("Failed to hydrate agent");
  }

  return { agent: created, agentKey: apiKey };
}

export function updateAgent(
  id: number,
  input: Partial<Pick<Agent, "name" | "role" | "parent_id" | "status" | "soul" | "last_seen">> & {
    config?: Record<string, unknown>;
  }
) {
  const db = getDb();
  const existing = getDb().prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
  if (!existing) {
    return null;
  }

  const nextConfig = input.config ?? parseJson<Record<string, unknown>>(existing.config_json, {});
  const next = {
    name: input.name ?? existing.name,
    role: input.role ?? existing.role,
    parent_id: input.parent_id ?? existing.parent_id,
    status: input.status ?? existing.status,
    soul: input.soul ?? existing.soul,
    config_json: stringifyJson(nextConfig),
    last_seen: input.last_seen ?? existing.last_seen,
  };

  db.prepare(
    "UPDATE agents SET name = ?, role = ?, parent_id = ?, status = ?, soul = ?, config_json = ?, last_seen = ? WHERE id = ?"
  ).run(next.name, next.role, next.parent_id, next.status, next.soul, next.config_json, next.last_seen, id);

  return getAgent(id);
}

export function deleteAgent(id: number) {
  const db = getDb();
  const existing = getDb().prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
  if (!existing) {
    return false;
  }

  db.prepare("UPDATE agents SET parent_id = ? WHERE parent_id = ?").run(existing.parent_id, id);
  db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  return true;
}

export function heartbeatAgent(id: number) {
  const db = getDb();
  const existing = getDb().prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
  if (!existing) {
    return null;
  }

  const status = existing.status === "offline" ? "idle" : existing.status;
  db.prepare("UPDATE agents SET last_seen = ?, status = ? WHERE id = ?").run(now(), status, id);
  return getAgent(id);
}

export function wakeAgent(id: number) {
  const db = getDb();
  const existing = getDb().prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
  if (!existing) {
    return null;
  }

  db.prepare("UPDATE agents SET status = ? WHERE id = ?").run("idle", id);
  return getAgent(id);
}

export function sleepAgent(id: number) {
  const db = getDb();
  const existing = getDb().prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
  if (!existing) {
    return null;
  }

  db.prepare("UPDATE agents SET status = ? WHERE id = ?").run("sleeping", id);
  return getAgent(id);
}

export const MOVE_AGENT_MAX_DEPTH = 50;

export type MoveAgentResult =
  | { ok: true; agent: Agent }
  | { ok: false; reason: "not_found" | "parent_not_found" | "self_parent" | "cycle" };

/**
 * Returns true if `newParentId` is `id` itself or a descendant of `id` —
 * i.e. making `newParentId` the parent of `id` would create a cycle.
 * Walks the parent chain upward from `newParentId`, guarded by a visited
 * Set and a max-depth cap so a pre-existing cycle in the data can't hang
 * the request.
 */
export function wouldCreateCycle(db: ReturnType<typeof getDb>, id: number, newParentId: number): boolean {
  if (newParentId === id) {
    return true;
  }

  const visited = new Set<number>();
  let cursor: number | null = newParentId;
  let depth = 0;

  while (cursor !== null && depth < MOVE_AGENT_MAX_DEPTH) {
    if (cursor === id) {
      return true;
    }
    if (visited.has(cursor)) {
      // Pre-existing cycle unrelated to `id` — bail out rather than loop forever.
      return true;
    }
    visited.add(cursor);

    const row = db.prepare("SELECT parent_id FROM agents WHERE id = ?").get(cursor) as { parent_id: number | null } | undefined;
    cursor = row?.parent_id ?? null;
    depth += 1;
  }

  if (cursor !== null && depth >= MOVE_AGENT_MAX_DEPTH) {
    // Chain too deep to resolve safely — treat as unsafe.
    return true;
  }

  return false;
}

export function moveAgent(id: number, newParentId: number | null): MoveAgentResult {
  const db = getDb();
  const existing = getDb().prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
  if (!existing) {
    return { ok: false, reason: "not_found" };
  }

  if (newParentId !== null) {
    if (newParentId === id) {
      return { ok: false, reason: "self_parent" };
    }

    const parentExists = getDb().prepare("SELECT id FROM agents WHERE id = ?").get(newParentId) as { id: number } | undefined;
    if (!parentExists) {
      return { ok: false, reason: "parent_not_found" };
    }

    if (wouldCreateCycle(db, id, newParentId)) {
      return { ok: false, reason: "cycle" };
    }
  }

  db.prepare("UPDATE agents SET parent_id = ? WHERE id = ?").run(newParentId, id);
  const updated = getAgent(id);
  if (!updated) {
    return { ok: false, reason: "not_found" };
  }

  return { ok: true, agent: updated };
}

export function listTasks(filters: { project_id?: number; status?: Task["status"]; agent_id?: number }) {
  const clauses: string[] = [];
  const params: Array<number | string> = [];

  if (filters.project_id) {
    clauses.push("project_id = ?");
    params.push(filters.project_id);
  }

  if (filters.status) {
    clauses.push("status = ?");
    params.push(filters.status);
  }

  if (filters.agent_id) {
    clauses.push("assigned_agent_id = ?");
    params.push(filters.agent_id);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb().prepare(`SELECT * FROM tasks ${where} ORDER BY updated_at DESC, id DESC`).all(...params) as TaskRow[];
  return rows.map(mapTask);
}

export function getTask(id: number) {
  const row = getDb().prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
  return row ? mapTask(row) : null;
}

export function listTaskComments(taskId: number) {
  const rows = getDb()
    .prepare("SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC, id ASC")
    .all(taskId) as TaskCommentRow[];
  return rows.map(mapTaskComment);
}

export function createTask(input: {
  project_id: number;
  title: string;
  description?: string;
  priority?: Task["priority"];
  assigned_agent_id?: number | null;
  parent_task_id?: number | null;
  created_by_agent_id?: number | null;
}) {
  const db = getDb();
  const timestamp = now();
  const result = db
    .prepare(
      "INSERT INTO tasks (project_id, title, description, status, priority, assigned_agent_id, created_by_agent_id, result, parent_task_id, created_at, updated_at) VALUES (?, ?, ?, 'backlog', ?, ?, ?, NULL, ?, ?, ?)"
    )
    .run(
      input.project_id,
      input.title,
      input.description ?? "",
      input.priority ?? "normal",
      input.assigned_agent_id ?? null,
      input.created_by_agent_id ?? null,
      input.parent_task_id ?? null,
      timestamp,
      timestamp
    );
  return getTask(Number(result.lastInsertRowid));
}

export function updateTask(id: number, input: Partial<Pick<Task, "project_id" | "title" | "description" | "status" | "priority" | "assigned_agent_id" | "created_by_agent_id" | "result" | "parent_task_id">>) {
  const db = getDb();
  const existing = getTask(id);
  if (!existing) {
    return null;
  }

  const next = {
    project_id: input.project_id ?? existing.project_id,
    title: input.title ?? existing.title,
    description: input.description ?? existing.description,
    status: input.status ?? existing.status,
    priority: input.priority ?? existing.priority,
    assigned_agent_id: input.assigned_agent_id ?? existing.assigned_agent_id,
    created_by_agent_id: input.created_by_agent_id ?? existing.created_by_agent_id,
    result: input.result ?? existing.result,
    parent_task_id: input.parent_task_id ?? existing.parent_task_id,
  };

  db.prepare(
    "UPDATE tasks SET project_id = ?, title = ?, description = ?, status = ?, priority = ?, assigned_agent_id = ?, created_by_agent_id = ?, result = ?, parent_task_id = ?, updated_at = ? WHERE id = ?"
  ).run(
    next.project_id,
    next.title,
    next.description,
    next.status,
    next.priority,
    next.assigned_agent_id,
    next.created_by_agent_id,
    next.result,
    next.parent_task_id,
    now(),
    id
  );

  return getTask(id);
}

export function deleteTask(id: number) {
  const existing = getTask(id);
  if (!existing) {
    return false;
  }

  getDb().prepare("DELETE FROM tasks WHERE id = ?").run(id);
  return true;
}

export function claimTask(taskId: number, agentId: number) {
  const existing = getTask(taskId);
  if (!existing) {
    return null;
  }

  getDb().prepare("UPDATE tasks SET assigned_agent_id = ?, status = ?, updated_at = ? WHERE id = ?").run(
    agentId,
    "in_progress",
    now(),
    taskId
  );

  return getTask(taskId);
}

export function resolveTaskCompletionStatus(projectId: number) {
  const ceo = getDb()
    .prepare("SELECT id, status FROM agents WHERE role = 'ceo' ORDER BY id ASC LIMIT 1")
    .get() as { id: number; status: string } | undefined;

  if (ceo && ["idle", "busy"].includes(ceo.status)) {
    return "review" as const;
  }

  return "done" as const;
}

export function completeTask(taskId: number, result: string) {
  const task = getTask(taskId);
  if (!task) {
    return null;
  }

  const status = resolveTaskCompletionStatus(task.project_id);
  getDb().prepare("UPDATE tasks SET result = ?, status = ?, updated_at = ? WHERE id = ?").run(result, status, now(), taskId);
  return getTask(taskId);
}

export function addTaskComment(input: { task_id: number; author_agent_id?: number | null; author_kind: TaskComment["author_kind"]; body: string }) {
  const db = getDb();
  const timestamp = now();
  const result = db
    .prepare("INSERT INTO task_comments (task_id, author_agent_id, author_kind, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(input.task_id, input.author_agent_id ?? null, input.author_kind, input.body, timestamp);
  const row = db.prepare("SELECT * FROM task_comments WHERE id = ?").get(Number(result.lastInsertRowid)) as TaskCommentRow | undefined;
  return row ? mapTaskComment(row) : null;
}

export function getProjectCeo(projectId: number) {
  const ceo = getDb()
    .prepare("SELECT * FROM agents WHERE role = 'ceo' ORDER BY id ASC LIMIT 1")
    .get() as AgentRow | undefined;

  return ceo ? mapAgent(ceo) : null;
}

export function getAgentApiKey(id: number) {
  const row = getDb().prepare("SELECT api_key FROM agents WHERE id = ?").get(id) as { api_key: string | null } | undefined;
  return row?.api_key ?? null;
}

export function setAgentApiKey(id: number, apiKey: string) {
  getDb().prepare("UPDATE agents SET api_key = ? WHERE id = ?").run(apiKey, id);
}
