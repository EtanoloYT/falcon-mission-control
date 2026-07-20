#!/usr/bin/env node
/**
 * Mission Control MCP server — one shared server for every agent.
 *
 * It is deliberately NOT one server per agent. OpenClaw exposes every
 * configured MCP server to every agent: per-agent `tools.allow`/`tools.deny`
 * do not filter MCP tools, and server entries have no agent-scoping field.
 * Per-agent servers therefore bought no isolation (any agent could call any
 * other's server and act as them) while multiplying every agent's tool
 * schemas by the roster size — which is what was blowing out the context
 * window and making orchestration turns fail outright.
 *
 * So identity travels per call instead: `work_token` is minted by Mission
 * Control when it dispatches a task and injected into that run's prompt. It
 * binds one agent to one task, and Mission Control re-checks the live
 * assignment on every call, so a reassigned task invalidates it immediately.
 *
 * Tool surface is kept small and parameters few on purpose — these agents run
 * on small local models, and every extra tool and argument is another thing
 * for them to get wrong. Anything derivable from the token is not a parameter.
 *
 * stdout carries MCP protocol frames only. All diagnostics go to stderr.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = (process.env.MC_BASE_URL ?? "http://127.0.0.1:3030").replace(/\/+$/, "");

/** Subtask nesting deeper than this is almost always a confused orchestrator. */
const MAX_DELEGATION_DEPTH = 3;

const workToken = z
  .string()
  .min(1)
  .describe("The work_token given to you in your task prompt. Copy it exactly.");

async function call(token, method, path, body) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        "x-mc-task-token": token,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    throw new Error(
      `Mission Control is unreachable at ${BASE_URL} (${error.message}). It may not be running.`
    );
  }

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Mission Control returned non-JSON (${response.status}): ${text.slice(0, 300)}`);
  }

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `Mission Control request failed (${response.status})`);
  }
  return payload.data;
}

const asText = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

/** Wraps a handler so thrown errors reach the model as readable tool errors. */
function tool(handler) {
  return async (args) => {
    try {
      return asText(await handler(args ?? {}));
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  };
}

const server = new McpServer({ name: "falcon-mission-control", version: "2.0.0" });

server.registerTool(
  "mc_whoami",
  {
    description:
      "Your identity, your current task, and your project — including target_folder, the absolute directory you must work in. Call this first.",
    inputSchema: { work_token: workToken },
  },
  tool(async ({ work_token }) => {
    const me = await call(work_token, "GET", "/api/agents/me");
    const project = me.task?.project_id
      ? await call(work_token, "GET", `/api/projects/${me.task.project_id}`)
      : null;

    return {
      ...me,
      project,
      working_directory_note:
        !project || project.target_folder === "AUTO"
          ? "No directory restriction."
          : `Create and modify files only under ${project.target_folder}, using absolute paths.`,
    };
  })
);

server.registerTool(
  "mc_list_agents",
  {
    description:
      "List the agents you can delegate to, with the integer id, name and role of each. Use the integer id with mc_delegate — never a name.",
    inputSchema: { work_token: workToken },
  },
  tool(({ work_token }) => call(work_token, "GET", "/api/agents/flat"))
);

server.registerTool(
  "mc_delegate",
  {
    description:
      "Create a subtask and assign it to another agent. It is queued and runs AFTER your turn ends — you cannot wait for its result, so never block on it. Call this once per subtask.",
    inputSchema: {
      work_token: workToken,
      assigned_agent_id: z
        .number()
        .int()
        .positive()
        .describe("Integer agent id from mc_list_agents. Must be a number, not a name."),
      title: z.string().min(1).describe("Short title for the subtask"),
      description: z.string().describe("What the assignee must do, including acceptance criteria"),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional().describe("Defaults to normal"),
    },
  },
  tool(async ({ work_token, assigned_agent_id, title, description, priority }) => {
    // The parent is whatever task the token was minted for — never a parameter,
    // so an agent cannot graft subtasks onto someone else's task.
    const me = await call(work_token, "GET", "/api/agents/me");
    const parent = me.task;
    if (!parent) {
      throw new Error("Your work_token is not bound to a task, so there is nothing to delegate from.");
    }

    // Walk up the parent chain so a confused orchestrator cannot fork-bomb the
    // serialized dispatch queue with unbounded nesting.
    let depth = 1;
    let cursor = parent.parent_task_id;
    while (cursor && depth <= MAX_DELEGATION_DEPTH) {
      const ancestor = await call(work_token, "GET", `/api/tasks/${cursor}`);
      cursor = ancestor.parent_task_id;
      depth += 1;
    }
    if (depth > MAX_DELEGATION_DEPTH) {
      throw new Error(
        `Delegation is already ${MAX_DELEGATION_DEPTH} levels deep. Do this work yourself instead of delegating further.`
      );
    }

    const created = await call(work_token, "POST", "/api/tasks", {
      project_id: parent.project_id,
      parent_task_id: parent.id,
      assigned_agent_id,
      title,
      description,
      priority: priority ?? "normal",
    });

    return {
      task_id: created.id,
      assigned_agent_id,
      status: "queued",
      note: "Queued. It runs after your turn ends — do not wait for it.",
    };
  })
);

server.registerTool(
  "mc_comment_task",
  {
    description:
      "Post a progress note on your current task. Use this to report what you have done so far on long work.",
    inputSchema: {
      work_token: workToken,
      body: z.string().min(1).describe("The note to post"),
    },
  },
  tool(async ({ work_token, body }) => {
    const me = await call(work_token, "GET", "/api/agents/me");
    if (!me.task) throw new Error("Your work_token is not bound to a task.");
    return call(work_token, "POST", `/api/tasks/${me.task.id}/comment`, { body });
  })
);

server.registerTool(
  "mc_complete_task",
  {
    description:
      "Mark your current task finished and record the outcome. Only call this once the work is actually done and verified.",
    inputSchema: {
      work_token: workToken,
      result: z.string().min(1).describe("What changed, how it was verified, any remaining blocker"),
    },
  },
  tool(async ({ work_token, result }) => {
    const me = await call(work_token, "GET", "/api/agents/me");
    if (!me.task) throw new Error("Your work_token is not bound to a task.");
    return call(work_token, "POST", `/api/tasks/${me.task.id}/complete`, { result });
  })
);

server.registerTool(
  "mc_get_task",
  {
    description: "Full detail for one task, including its comments. Omit task_id for your own current task.",
    inputSchema: {
      work_token: workToken,
      task_id: z.number().int().positive().optional().describe("Defaults to your current task"),
    },
  },
  tool(async ({ work_token, task_id }) => {
    if (task_id) return call(work_token, "GET", `/api/tasks/${task_id}`);
    const me = await call(work_token, "GET", "/api/agents/me");
    if (!me.task) throw new Error("Your work_token is not bound to a task.");
    return call(work_token, "GET", `/api/tasks/${me.task.id}`);
  })
);

server.registerTool(
  "mc_list_tasks",
  {
    description:
      "List tasks in your project, so you can see what already exists before creating more. Optionally filter by status.",
    inputSchema: {
      work_token: workToken,
      status: z
        .enum(["backlog", "assigned", "in_progress", "review", "done", "failed"])
        .optional()
        .describe("Only tasks in this status"),
    },
  },
  tool(async ({ work_token, status }) => {
    const me = await call(work_token, "GET", "/api/agents/me");
    const query = new URLSearchParams();
    if (me.task?.project_id) query.set("project_id", String(me.task.project_id));
    if (status) query.set("status", status);
    const suffix = query.toString() ? `?${query}` : "";
    return call(work_token, "GET", `/api/tasks${suffix}`);
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[mc-mcp] shared Mission Control server connected against ${BASE_URL}`);
