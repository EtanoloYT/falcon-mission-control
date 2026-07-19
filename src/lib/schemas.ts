import { z } from "zod";

export const projectStatusSchema = z.enum(["active", "archived"]);
export const agentRoleSchema = z.enum([
  "ceo",
  "manager",
  "coder",
  "reviewer",
  "researcher",
  "tester",
  "devops",
  "agent",
]);
export const agentStatusSchema = z.enum(["offline", "idle", "busy", "sleeping", "error"]);
export const taskStatusSchema = z.enum(["backlog", "assigned", "in_progress", "review", "done", "failed"]);
export const taskPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const authorKindSchema = z.enum(["agent", "user", "system"]);
export const eventKindSchema = z.enum([
  "task.created",
  "task.updated",
  "task.deleted",
  "task.comment",
  "agent.status",
  "agent.created",
  "agent.updated",
  "agent.deleted",
  "project.updated",
  "project.created",
  "project.deleted",
  "gateway.status",
  "heartbeat",
]);

export const configSchema = z
  .object({
    openclawId: z.union([z.string(), z.number()]).optional(),
    model: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
  })
  .passthrough();

export const projectBaseSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  status: projectStatusSchema,
  created_at: z.number(),
  updated_at: z.number(),
});

export type Project = z.infer<typeof projectBaseSchema>;

export const agentBaseSchema = z.object({
  id: z.number(),
  name: z.string(),
  role: agentRoleSchema,
  parent_id: z.number().nullable(),
  status: agentStatusSchema,
  soul: z.string(),
  config: configSchema,
  last_seen: z.number().nullable(),
  created_at: z.number(),
  api_key_masked: z.string().nullable().optional(),
});

export type Agent = z.infer<typeof agentBaseSchema>;

export interface AgentTree extends Agent {
  children: AgentTree[];
}

export const agentTreeSchema = agentBaseSchema.extend({
  children: z.array(z.any()),
}) as unknown as z.ZodType<AgentTree>;

export const taskCommentSchema = z.object({
  id: z.number(),
  task_id: z.number(),
  author_agent_id: z.number().nullable(),
  author_kind: authorKindSchema,
  body: z.string(),
  created_at: z.number(),
});

export type TaskComment = z.infer<typeof taskCommentSchema>;

export const taskBaseSchema = z.object({
  id: z.number(),
  project_id: z.number(),
  title: z.string(),
  description: z.string(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  assigned_agent_id: z.number().nullable(),
  created_by_agent_id: z.number().nullable(),
  result: z.string().nullable(),
  parent_task_id: z.number().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});

export type Task = z.infer<typeof taskBaseSchema>;

export const taskDetailSchema = taskBaseSchema.extend({
  comments: z.array(taskCommentSchema),
});

export const eventSchema = z.object({
  id: z.number(),
  kind: eventKindSchema,
  payload: z.unknown(),
  ts: z.number(),
});

export type Event = z.infer<typeof eventSchema>;

export const healthSchema = z.object({
  ok: z.literal(true),
  gateway: z.object({
    reachable: z.boolean(),
    uptime: z.number().optional(),
  }),
});

export const projectCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
});

export const projectPatchSchema = projectCreateSchema.partial().extend({
  status: projectStatusSchema.optional(),
});

export const agentCreateSchema = z.object({
  name: z.string().min(1),
  role: agentRoleSchema,
  parent_id: z.number().int().positive().nullable().optional(),
  soul: z.string().optional(),
  config: configSchema.optional(),
});

export const agentPatchSchema = z.object({
  name: z.string().min(1).optional(),
  role: agentRoleSchema.optional(),
  parent_id: z.number().int().positive().nullable().optional(),
  status: agentStatusSchema.optional(),
  soul: z.string().optional(),
  config: configSchema.optional(),
  last_seen: z.number().nullable().optional(),
});

export const agentMoveSchema = z.object({
  new_parent_id: z.number().int().positive().nullable(),
});

export const heartbeatSchema = z.object({}).strict();

export const taskCreateSchema = z.object({
  project_id: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().optional(),
  priority: taskPrioritySchema.optional(),
  assigned_agent_id: z.number().int().positive().nullable().optional(),
  parent_task_id: z.number().int().positive().nullable().optional(),
});

export const taskPatchSchema = z.object({
  project_id: z.number().int().positive().optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigned_agent_id: z.number().int().positive().nullable().optional(),
  created_by_agent_id: z.number().int().positive().nullable().optional(),
  result: z.string().nullable().optional(),
  parent_task_id: z.number().int().positive().nullable().optional(),
});

export const taskCommentCreateSchema = z.object({
  body: z.string().min(1),
});

export const taskCompleteSchema = z.object({
  result: z.string().min(1),
});

export const taskQuerySchema = z.object({
  project_id: z.coerce.number().int().positive().optional(),
  status: taskStatusSchema.optional(),
  agent_id: z.coerce.number().int().positive().optional(),
});

export const eventsQuerySchema = z.object({
  since: z.coerce.number().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const openclawInvokeSchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
  sessionKey: z.string().optional(),
});

export const openclawDispatchSchema = z.object({
  agent_id: z.number().int().positive(),
  task_id: z.number().int().positive(),
});

export const apiOkSchema = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({
    ok: z.literal(true),
    data: schema,
  });

export const apiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
});
