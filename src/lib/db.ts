import "server-only";

import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { type Agent, type Event, type Project, type Task, type TaskComment } from "@/lib/schemas";

export type ProjectStatus = "active" | "archived";
export type AgentRole =
  | "ceo"
  | "manager"
  | "coder"
  | "reviewer"
  | "researcher"
  | "tester"
  | "devops"
  | "agent";
export type AgentStatus = "offline" | "idle" | "busy" | "sleeping" | "error";
export type TaskStatus =
  | "backlog"
  | "assigned"
  | "in_progress"
  | "review"
  | "done"
  | "failed";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface ProjectRow {
  id: number;
  name: string;
  description: string;
  status: ProjectStatus;
  /** Absolute path the agents should work in, or "AUTO" for no restriction. */
  target_folder: string;
  created_at: number;
  updated_at: number;
}

export interface AgentRow {
  id: number;
  name: string;
  role: AgentRole;
  parent_id: number | null;
  status: AgentStatus;
  soul: string;
  config_json: string;
  last_seen: number | null;
  created_at: number;
  api_key: string | null;
}

export interface TaskRow {
  id: number;
  project_id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_agent_id: number | null;
  created_by_agent_id: number | null;
  result: string | null;
  parent_task_id: number | null;
  created_at: number;
  updated_at: number;
}

export interface TaskCommentRow {
  id: number;
  task_id: number;
  author_agent_id: number | null;
  author_kind: "agent" | "user" | "system";
  body: string;
  created_at: number;
}

export interface EventRow {
  id: number;
  ts: number;
  kind: string;
  payload_json: string;
}

type SqliteDatabase = Database.Database;

const databasePath = path.resolve(process.cwd(), process.env.DATABASE_PATH ?? "./data/mc.db");
const globalState = globalThis as typeof globalThis & { mcDatabase?: SqliteDatabase; mcApiKey?: string };

const schemaSql = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  target_folder TEXT NOT NULL DEFAULT 'AUTO',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  parent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'offline',
  soul TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL DEFAULT '{}',
  last_seen INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_id);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'backlog',
  priority TEXT NOT NULL DEFAULT 'normal',
  assigned_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  created_by_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  result TEXT,
  parent_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(assigned_agent_id);

CREATE TABLE IF NOT EXISTS task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  author_kind TEXT NOT NULL DEFAULT 'agent',
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
`;

function ensureDirectoryExists() {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
}

function ensureColumn(db: SqliteDatabase, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function openDatabase() {
  ensureDirectoryExists();
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.exec(schemaSql);
  ensureColumn(db, "agents", "api_key", "TEXT");
  ensureColumn(db, "projects", "target_folder", "TEXT NOT NULL DEFAULT 'AUTO'");
  return db;
}

export function getDb() {
  if (!globalState.mcDatabase) {
    globalState.mcDatabase = openDatabase();
  }

  return globalState.mcDatabase;
}

export function now() {
  return Date.now();
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function getApiKeySecret() {
  if (process.env.MC_API_KEY) {
    return process.env.MC_API_KEY;
  }

  if (!globalState.mcApiKey) {
    globalState.mcApiKey = randomToken(32);
    process.env.MC_API_KEY = globalState.mcApiKey;
    // Printed once so the operator can capture the generated key in local dev.
    console.log(`[falcon-mission-control] Generated MC_API_KEY=${globalState.mcApiKey}`);
  }

  return globalState.mcApiKey;
}

export function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: unknown) {
  return JSON.stringify(value ?? {});
}

export function pruneEvents(db: SqliteDatabase) {
  const cutoff = db
    .prepare("SELECT id FROM events ORDER BY id DESC LIMIT 1 OFFSET 4999")
    .get() as { id: number } | undefined;

  if (cutoff) {
    db.prepare("DELETE FROM events WHERE id < ?").run(cutoff.id);
  }
}

export function generateApiKey() {
  return randomToken(32);
}

export function generateSessionId() {
  return randomToken(24);
}

export function mapProject(row: ProjectRow): Project {
  return row;
}

export function mapAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    parent_id: row.parent_id,
    status: row.status,
    soul: row.soul,
    config: parseJson<Record<string, unknown>>(row.config_json, {}),
    last_seen: row.last_seen,
    created_at: row.created_at,
    api_key_masked: row.api_key ? `${row.api_key.slice(0, 4)}••••${row.api_key.slice(-4)}` : null,
  };
}

export function mapTask(row: TaskRow): Task {
  return row;
}

export function mapTaskComment(row: TaskCommentRow): TaskComment {
  return row;
}

export function mapEvent(row: EventRow): Event {
  return {
    id: row.id,
    ts: row.ts,
    kind: row.kind as Event["kind"],
    payload: parseJson(row.payload_json, {}),
  };
}
