"use client";

import { useEffect, useMemo, useState } from "react";

import { useParams } from "next/navigation";
import { ArrowLeft, Check, Clock3, PencilLine, Plus, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";

import { useLiveEvents } from "@/components/live-events-provider";
import { Badge, Button, Card, CardBody, CardHeader, Drawer, Input, Label, Modal, Select, Textarea } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { apiGet, apiPatch, apiPost } from "@/lib/client";
import { cn } from "@/lib/utils";
import type { Agent, Project, Task } from "@/lib/schemas";

type TaskDetail = Task & { comments: Array<{ id: number; body: string; created_at: number; author_kind: string }> };

const statuses: Array<Task["status"]> = ["backlog", "assigned", "in_progress", "review", "done", "failed"];

export default function ProjectBoardPage() {
  const params = useParams<{ id: string }>();
  const projectId = Number(params.id);
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedTask, setSelectedTask] = useState<TaskDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [briefOpen, setBriefOpen] = useState(true);
  const [createForm, setCreateForm] = useState<{
    title: string;
    description: string;
    priority: string;
    assigned_agent_id: string;
    parent_task_id: number | null;
  }>({ title: "", description: "", priority: "normal", assigned_agent_id: "", parent_task_id: null });
  const [detailComment, setDetailComment] = useState("");
  const [detailResult, setDetailResult] = useState("");
  const { latestEvent } = useLiveEvents();

  const load = async () => {
    const [nextProject, nextTasks, nextAgents] = await Promise.all([
      apiGet<Project>(`/api/projects/${projectId}`),
      apiGet<Task[]>(`/api/tasks?project_id=${projectId}`),
      apiGet<Agent[]>("/api/agents/flat"),
    ]);
    setProject(nextProject);
    setTasks(nextTasks);
    setAgents(nextAgents);
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  useEffect(() => {
    if (!latestEvent) {
      return;
    }

    void load();
    if (selectedTask) {
      void openTask(selectedTask.id);
    }
  }, [latestEvent]);

  const columns = useMemo(
    () =>
      statuses.map((status) => ({
        status,
        tasks: tasks.filter((task) => task.status === status),
      })),
    [tasks]
  );

  async function openTask(taskId: number) {
    const detail = await apiGet<TaskDetail>(`/api/tasks/${taskId}`);
    setSelectedTask(detail);
    setDetailComment("");
    setDetailResult(detail.result ?? "");
  }

  async function createTask() {
    await apiPost("/api/tasks", {
      project_id: projectId,
      title: createForm.title,
      description: createForm.description,
      priority: createForm.priority,
      assigned_agent_id: createForm.assigned_agent_id ? Number(createForm.assigned_agent_id) : null,
      parent_task_id: createForm.parent_task_id,
    });
    setShowCreate(false);
    setCreateForm({ title: "", description: "", priority: "normal", assigned_agent_id: "", parent_task_id: null });
    await load();
  }

  function openNewSubtaskForm(parentTaskId: number) {
    setCreateForm({ title: "", description: "", priority: "normal", assigned_agent_id: "", parent_task_id: parentTaskId });
    setShowCreate(true);
  }

  function openNewTaskForm() {
    setCreateForm({ title: "", description: "", priority: "normal", assigned_agent_id: "", parent_task_id: null });
    setShowCreate(true);
  }

  async function updateTaskStatus(taskId: number, status: Task["status"]) {
    await apiPatch(`/api/tasks/${taskId}`, { status });
    await load();
    if (selectedTask?.id === taskId) {
      await openTask(taskId);
    }
  }

  async function assignTask(taskId: number, assigned_agent_id: number | null) {
    await apiPatch(`/api/tasks/${taskId}`, { assigned_agent_id });
    await load();
    if (selectedTask?.id === taskId) {
      await openTask(taskId);
    }
  }

  async function addComment(taskId: number) {
    if (!detailComment.trim()) return;
    await apiPost(`/api/tasks/${taskId}/comment`, { body: detailComment });
    setDetailComment("");
    await openTask(taskId);
  }

  async function completeTask(taskId: number) {
    await apiPost(`/api/tasks/${taskId}/complete`, { result: detailResult });
    await load();
    await openTask(taskId);
  }

  async function rejectTask(taskId: number) {
    await apiPatch(`/api/tasks/${taskId}`, { status: "failed" });
    await load();
    await openTask(taskId);
  }

  if (!project) {
    return <div className="text-sm text-zinc-500">Loading project...</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Link href="/projects" className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to projects
          </Link>
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Project</div>
            <h1 className="text-2xl font-semibold text-zinc-50">{project.name}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{project.status}</Badge>
          <Button variant="outline" size="sm" onClick={() => openNewTaskForm()}>
            New task
          </Button>
        </div>
      </div>

      <Card className="border-zinc-800 bg-zinc-950/70">
        <CardHeader className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-zinc-100">Project Brief (shown to CEO on every delegation)</div>
            <div className="text-xs text-zinc-500">Persistent context for the CEO agent</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setBriefOpen((value) => !value)}>
            <PencilLine className="h-4 w-4" />
            {briefOpen ? "Collapse" : "Expand"}
          </Button>
        </CardHeader>
        {briefOpen ? (
          <CardBody>
            <Markdown value={project.description || "_No brief yet._"} />
          </CardBody>
        ) : null}
      </Card>

      <div className="min-w-0 max-w-full overflow-x-auto pb-2">
        <div className="flex w-max gap-4 pr-4">
          {columns.map((column) => {
            const isFailed = column.status === "failed";
            return (
              <Card
                key={column.status}
                className={cn("w-[280px] shrink-0 border-zinc-800 bg-zinc-950/70", isFailed && "border-red-900/60 bg-red-500/[0.03]")}
              >
                <CardHeader className={cn("flex items-center justify-between gap-2", isFailed && "border-red-900/60")}>
                  <div>
                    <div className={cn("text-sm font-medium capitalize", isFailed ? "text-red-400" : "text-zinc-100")}>
                      {column.status.replaceAll("_", " ")}
                    </div>
                    <div className={cn("text-xs", isFailed ? "text-red-400/70" : "text-zinc-500")}>{column.tasks.length} task(s)</div>
                  </div>
                  {column.status === "backlog" ? (
                    <Button variant="outline" size="sm" onClick={() => openNewTaskForm()}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  ) : null}
                </CardHeader>
                <CardBody className="space-y-2">
                  {column.tasks.map((task) => {
                    const childCount = tasks.filter((child) => child.parent_task_id === task.id).length;
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => void openTask(task.id)}
                        className={cn(
                          "group w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-left transition-colors hover:border-amber-500/40 hover:bg-zinc-900/80",
                          isFailed && "border-red-900/40 hover:border-red-500/50"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-zinc-100 break-words [overflow-wrap:anywhere]">{task.title}</div>
                            <div className="mt-1 line-clamp-2 text-xs text-zinc-500">{task.description || "No description"}</div>
                          </div>
                          <Badge className={isFailed ? "border-red-900 bg-red-500/10 text-red-400" : undefined}>{task.priority}</Badge>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                          <span>{formatAge(task.created_at)}</span>
                          <span>{agentNameForId(agents, task.assigned_agent_id)}</span>
                        </div>
                        {task.parent_task_id || childCount > 0 ? (
                          <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                            {task.parent_task_id ? <span>Subtask</span> : null}
                            {childCount > 0 ? (
                              <span>
                                {childCount} subtask{childCount === 1 ? "" : "s"}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="mt-3 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                          {nextStatuses(task.status).map((nextStatus) => (
                            <span key={nextStatus} className="inline-flex items-center gap-1 rounded-full border border-zinc-800 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                              {nextStatus.replaceAll("_", " ")}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                  {column.tasks.length === 0 ? <div className="rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-sm text-zinc-500">No tasks here.</div> : null}
                </CardBody>
              </Card>
            );
          })}
        </div>
      </div>

      <Drawer
        open={Boolean(selectedTask)}
        title={selectedTask ? `Task #${selectedTask.id}` : "Task"}
        onClose={() => setSelectedTask(null)}
        footer={selectedTask ? <div className="flex justify-between gap-2"><Button variant="outline" onClick={() => void completeTask(selectedTask.id)}><Check className="h-4 w-4" /> Complete</Button><Button variant="danger" onClick={() => void rejectTask(selectedTask.id)}><RotateCcw className="h-4 w-4" /> Reject</Button></div> : null}
      >
        {selectedTask ? (
          <div className="min-w-0 space-y-4">
            {selectedTask.parent_task_id ? (
              <button
                type="button"
                onClick={() => void openTask(selectedTask.parent_task_id!)}
                className="inline-flex items-center gap-1 text-xs uppercase tracking-[0.18em] text-amber-500 hover:text-amber-400"
              >
                Subtask of {parentTitleForTask(tasks, selectedTask.parent_task_id)}
              </button>
            ) : null}

            <div className="min-w-0">
              <div className="text-lg font-semibold text-zinc-50 break-words">{selectedTask.title}</div>
              <div className="mt-1 text-sm text-zinc-400 break-words">{selectedTask.description || "No description"}</div>
              <div className="mt-2 text-xs text-zinc-500">
                Filed by <span className="text-zinc-300">{creatorNameForTask(agents, selectedTask.created_by_agent_id)}</span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-2">
                <Label>Assign to</Label>
                <Select value={selectedTask.assigned_agent_id?.toString() ?? ""} onChange={(event) => void assignTask(selectedTask.id, event.target.value ? Number(event.target.value) : null)}>
                  <option value="">Unassigned</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="block space-y-2">
                <Label>Status</Label>
                <Select value={selectedTask.status} onChange={(event) => void updateTaskStatus(selectedTask.id, event.target.value as Task["status"])}>
                  {statuses.map((status) => (
                    <option key={status} value={status}>
                      {status.replaceAll("_", " ")}
                    </option>
                  ))}
                </Select>
              </label>
            </div>

            {selectedTask.result ? (
              <div className="min-w-0 space-y-2">
                <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Result</div>
                <div className="min-w-0 max-h-72 overflow-y-auto overflow-x-hidden rounded-lg border border-zinc-800 bg-zinc-950 p-3 [overflow-wrap:anywhere]">
                  <Markdown value={selectedTask.result} />
                </div>
              </div>
            ) : null}

            <label className="block space-y-2">
              <Label>Completion result</Label>
              <Textarea value={detailResult} onChange={(event) => setDetailResult(event.target.value)} rows={5} placeholder="What changed, what is next, and any blockers..." />
            </label>

            <div className="space-y-2">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Comments</div>
              <div className="space-y-2 max-h-56 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                {selectedTask.comments.map((comment) => (
                  <div key={comment.id} className="min-w-0 rounded-lg border border-zinc-900 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 break-words">
                    <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-zinc-500">{comment.author_kind} · {new Date(comment.created_at).toLocaleString()}</div>
                    {comment.body}
                  </div>
                ))}
                {selectedTask.comments.length === 0 ? <div className="text-sm text-zinc-500">No comments yet.</div> : null}
              </div>
              <div className="flex gap-2">
                <Input value={detailComment} onChange={(event) => setDetailComment(event.target.value)} placeholder="Add a comment..." />
                <Button type="button" onClick={() => void addComment(selectedTask.id)}>
                  Comment
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Subtasks</div>
                <Button variant="outline" size="sm" type="button" onClick={() => openNewSubtaskForm(selectedTask.id)}>
                  <Plus className="h-4 w-4" />
                  New subtask
                </Button>
              </div>
              <div className="space-y-2">
                {tasks
                  .filter((task) => task.parent_task_id === selectedTask.id)
                  .map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => void openTask(child.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-sm text-zinc-200 hover:border-amber-500/40 hover:bg-zinc-900/80"
                    >
                      <span className="min-w-0 truncate">{child.title}</span>
                      <Badge className={child.status === "failed" ? "border-red-900 bg-red-500/10 text-red-400" : undefined}>
                        {child.status.replaceAll("_", " ")}
                      </Badge>
                    </button>
                  ))}
                {tasks.filter((task) => task.parent_task_id === selectedTask.id).length === 0 ? (
                  <div className="text-sm text-zinc-500">No subtasks yet.</div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={showCreate}
        title={createForm.parent_task_id ? "New subtask" : "New task"}
        onClose={() => setShowCreate(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowCreate(false)} type="button">
              Cancel
            </Button>
            <Button onClick={() => void createTask()} type="button" disabled={!createForm.title.trim()}>
              Create task
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {createForm.parent_task_id ? (
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              Subtask of {parentTitleForTask(tasks, createForm.parent_task_id)}
            </div>
          ) : null}
          <label className="block space-y-2">
            <Label>Title</Label>
            <Input value={createForm.title} onChange={(event) => setCreateForm((value) => ({ ...value, title: event.target.value }))} placeholder="Write unit tests for auth" />
          </label>
          <label className="block space-y-2">
            <Label>Description</Label>
            <Textarea value={createForm.description} onChange={(event) => setCreateForm((value) => ({ ...value, description: event.target.value }))} rows={6} placeholder="Task detail for the CEO and assignee..." />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-2">
              <Label>Priority</Label>
              <Select value={createForm.priority} onChange={(event) => setCreateForm((value) => ({ ...value, priority: event.target.value }))}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </Select>
            </label>
            <label className="block space-y-2">
              <Label>Assign to</Label>
              <Select value={createForm.assigned_agent_id} onChange={(event) => setCreateForm((value) => ({ ...value, assigned_agent_id: event.target.value }))}>
                <option value="">Unassigned</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function agentNameForId(agents: Agent[], agentId: number | null) {
  if (!agentId) {
    return "unassigned";
  }

  return agents.find((agent) => agent.id === agentId)?.name ?? "unknown";
}

function creatorNameForTask(agents: Agent[], createdByAgentId: number | null) {
  if (!createdByAgentId) {
    return "Operator";
  }

  return agents.find((agent) => agent.id === createdByAgentId)?.name ?? "Unknown agent";
}

function parentTitleForTask(tasks: Task[], parentTaskId: number | null) {
  if (!parentTaskId) {
    return "";
  }

  return tasks.find((task) => task.id === parentTaskId)?.title ?? `#${parentTaskId}`;
}

function nextStatuses(status: Task["status"]) {
  const next = {
    backlog: ["assigned", "in_progress"],
    assigned: ["in_progress", "review"],
    in_progress: ["review", "done"],
    review: ["done", "failed"],
    done: [],
    failed: ["backlog", "assigned"],
  } as const;

  return next[status] ?? [];
}

function formatAge(ts: number) {
  const delta = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
