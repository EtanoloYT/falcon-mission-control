"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, Clock3, PencilLine, Plus, RotateCcw, Send, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import { useLiveEvents } from "@/components/live-events-provider";
import { Badge, Button, Card, CardBody, CardHeader, Drawer, Input, Label, Modal, Select, Textarea } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/client";
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
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [overColumnStatus, setOverColumnStatus] = useState<Task["status"] | null>(null);
  const [dispatchAgentId, setDispatchAgentId] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [dispatchOutcome, setDispatchOutcome] = useState<{ tool: string } | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [deleteTaskOpen, setDeleteTaskOpen] = useState(false);
  const [deletingTask, setDeletingTask] = useState(false);
  const [deleteTaskError, setDeleteTaskError] = useState<string | null>(null);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [deleteProjectError, setDeleteProjectError] = useState<string | null>(null);
  const { latestEvent } = useLiveEvents();
  const router = useRouter();
  const boardScrollRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

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
      void openTask(selectedTask.id).catch(() => {
        // Task may have just been deleted (e.g. by this drawer's own delete action); close it instead of crashing.
        setSelectedTask(null);
      });
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
    setDispatchAgentId(detail.assigned_agent_id ? String(detail.assigned_agent_id) : "");
    setDispatchOutcome(null);
    setDispatchError(null);
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

  function handleDragStart(event: DragStartEvent) {
    const taskId = event.active.data.current?.taskId as number | undefined;
    setActiveTaskId(taskId ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    const status = event.over?.data.current?.status as Task["status"] | undefined;
    setOverColumnStatus(status ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTaskId(null);
    setOverColumnStatus(null);

    const taskId = active.data.current?.taskId as number | undefined;
    const nextStatus = over?.data.current?.status as Task["status"] | undefined;
    if (!taskId || !nextStatus) {
      return;
    }

    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task || task.status === nextStatus) {
      return;
    }

    const previousTasks = tasks;
    setTasks((current) => current.map((candidate) => (candidate.id === taskId ? { ...candidate, status: nextStatus } : candidate)));

    apiPatch(`/api/tasks/${taskId}`, { status: nextStatus }).catch(() => {
      setTasks(previousTasks);
    });
  }

  function handleDragCancel() {
    setActiveTaskId(null);
    setOverColumnStatus(null);
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

  async function dispatchTask(taskId: number) {
    if (!dispatchAgentId) return;
    setDispatching(true);
    setDispatchOutcome(null);
    setDispatchError(null);
    try {
      const response = await fetch("/api/openclaw/dispatch", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent_id: Number(dispatchAgentId), task_id: taskId }),
      });
      const rawBody = await response.text();
      let payload: { ok?: boolean; data?: { tool: string }; error?: string } | null = null;
      try {
        payload = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        payload = null;
      }

      if (!response.ok || !payload?.ok) {
        const message =
          payload?.error ??
          (rawBody
            ? rawBody
            : `Dispatch request failed (HTTP ${response.status}). The gateway likely rejected or could not reach the request — check OPENCLAW_GATEWAY_TOKEN and OPENCLAW_GATEWAY_URL.`);
        throw new Error(message);
      }

      setDispatchOutcome({ tool: payload.data!.tool });
      await load();
      await openTask(taskId);
    } catch (error) {
      setDispatchError(error instanceof Error ? error.message : "Dispatch failed.");
    } finally {
      setDispatching(false);
    }
  }

  async function deleteTask(taskId: number) {
    setDeletingTask(true);
    setDeleteTaskError(null);
    try {
      await apiDelete(`/api/tasks/${taskId}`);
      setDeleteTaskOpen(false);
      setSelectedTask(null);
      await load();
    } catch (error) {
      setDeleteTaskError(error instanceof Error ? error.message : "Failed to delete task.");
    } finally {
      setDeletingTask(false);
    }
  }

  async function deleteProjectAction() {
    setDeletingProject(true);
    setDeleteProjectError(null);
    try {
      await apiDelete(`/api/projects/${projectId}`);
      router.push("/projects");
    } catch (error) {
      setDeleteProjectError(error instanceof Error ? error.message : "Failed to delete project.");
      setDeletingProject(false);
    }
  }

  function scrollToFailedColumn() {
    const target = boardScrollRef.current?.querySelector('[data-column-status="failed"]');
    target?.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" });
  }

  const activeTask = activeTaskId ? tasks.find((task) => task.id === activeTaskId) ?? null : null;
  const failedCount = useMemo(() => tasks.filter((task) => task.status === "failed").length, [tasks]);
  const selectedTaskSubtaskCount = selectedTask ? tasks.filter((task) => task.parent_task_id === selectedTask.id).length : 0;

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
          {failedCount > 0 ? (
            <button
              type="button"
              onClick={scrollToFailedColumn}
              className="inline-flex items-center gap-1 rounded-full border border-red-900 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-red-400 hover:bg-red-500/20"
            >
              <AlertTriangle className="h-3 w-3" />
              {failedCount} failed
            </button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => openNewTaskForm()}>
            New task
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              setDeleteProjectError(null);
              setDeleteProjectOpen(true);
            }}
          >
            <Trash2 className="h-4 w-4" />
            Delete project
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

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        autoScroll={{ threshold: { x: 0.2, y: 0.2 } }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div ref={boardScrollRef} className="min-w-0 max-w-full overflow-x-auto pb-2">
          <div className="flex w-max gap-4 pr-4">
            {columns.map((column) => (
              <BoardColumn
                key={column.status}
                status={column.status}
                columnTasks={column.tasks}
                tasks={tasks}
                agents={agents}
                isOver={overColumnStatus === column.status}
                onOpenTask={openTask}
                onNewTask={openNewTaskForm}
              />
            ))}
          </div>
        </div>

        <DragOverlay>{activeTask ? <TaskCardPreview task={activeTask} tasks={tasks} agents={agents} /> : null}</DragOverlay>
      </DndContext>

      <Drawer
        open={Boolean(selectedTask)}
        title={selectedTask ? `Task #${selectedTask.id}` : "Task"}
        onClose={() => setSelectedTask(null)}
        footer={
          selectedTask ? (
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="danger"
                onClick={() => {
                  setDeleteTaskError(null);
                  setDeleteTaskOpen(true);
                }}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void completeTask(selectedTask.id)}><Check className="h-4 w-4" /> Complete</Button>
                <Button variant="danger" onClick={() => void rejectTask(selectedTask.id)}><RotateCcw className="h-4 w-4" /> Reject</Button>
              </div>
            </div>
          ) : null
        }
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

            <div className="min-w-0 space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
                <Send className="h-3.5 w-3.5" />
                Dispatch to OpenClaw
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select
                  value={dispatchAgentId}
                  onChange={(event) => setDispatchAgentId(event.target.value)}
                  className="sm:flex-1"
                >
                  <option value="">Select agent</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  disabled={!dispatchAgentId || dispatching}
                  onClick={() => void dispatchTask(selectedTask.id)}
                >
                  {dispatching ? "Dispatching..." : "Dispatch"}
                </Button>
              </div>
              {dispatchOutcome ? (
                <div className="rounded-md border border-emerald-900/60 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
                  Dispatched via{" "}
                  <span className="font-medium">
                    {dispatchOutcome.tool === "openclaw_agent"
                      ? "OpenClaw agent runner (queued)"
                      : dispatchOutcome.tool}
                  </span>
                  .
                </div>
              ) : null}
              {dispatchError ? (
                <div className="min-w-0 rounded-md border border-red-900/60 bg-red-500/10 px-3 py-2 text-xs text-red-400 break-words [overflow-wrap:anywhere]">
                  {dispatchError}
                </div>
              ) : null}
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
                <option value="">CEO / orchestrator (automatic)</option>
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

      <Modal
        open={deleteTaskOpen}
        title="Delete task"
        onClose={() => {
          if (!deletingTask) setDeleteTaskOpen(false);
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTaskOpen(false)} type="button" disabled={deletingTask}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => selectedTask && void deleteTask(selectedTask.id)}
              type="button"
              disabled={deletingTask}
            >
              {deletingTask ? "Deleting..." : "Delete task"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-zinc-300">
          {selectedTask ? (
            <>
              <p>
                Delete <span className="font-medium text-zinc-100">&ldquo;{selectedTask.title}&rdquo;</span>? This
                will permanently delete the task and all of its comments. This cannot be undone.
              </p>
              {selectedTaskSubtaskCount > 0 ? (
                <p className="text-amber-400">
                  This task has {selectedTaskSubtaskCount} subtask{selectedTaskSubtaskCount === 1 ? "" : "s"}. They
                  will not be deleted — they will become top-level tasks (unparented).
                </p>
              ) : null}
              {deleteTaskError ? <p className="text-xs text-red-400">{deleteTaskError}</p> : null}
            </>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={deleteProjectOpen}
        title="Delete project"
        onClose={() => {
          if (!deletingProject) setDeleteProjectOpen(false);
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteProjectOpen(false)} type="button" disabled={deletingProject}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void deleteProjectAction()} type="button" disabled={deletingProject}>
              {deletingProject ? "Deleting..." : "Delete project"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-zinc-300">
          <p>
            Delete <span className="font-medium text-zinc-100">&ldquo;{project.name}&rdquo;</span>? This will
            permanently destroy{" "}
            <span className="font-medium text-red-400">
              {tasks.length} task{tasks.length === 1 ? "" : "s"}
            </span>{" "}
            and all of their comments. This cannot be undone.
          </p>
          {deleteProjectError ? <p className="text-xs text-red-400">{deleteProjectError}</p> : null}
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

function BoardColumn({
  status,
  columnTasks,
  tasks,
  agents,
  isOver,
  onOpenTask,
  onNewTask,
}: {
  status: Task["status"];
  columnTasks: Task[];
  tasks: Task[];
  agents: Agent[];
  isOver: boolean;
  onOpenTask: (taskId: number) => void;
  onNewTask: () => void;
}) {
  const isFailed = status === "failed";
  const { setNodeRef } = useDroppable({ id: `column-${status}`, data: { status } });

  return (
    <div ref={setNodeRef} data-column-status={status} className="w-[280px] shrink-0">
      <Card
        className={cn(
          "border-zinc-800 bg-zinc-950/70 transition-colors",
          isFailed && "border-red-900/60 bg-red-500/[0.03]",
          isOver && (isFailed ? "border-red-500/70" : "border-amber-500/60")
        )}
      >
        <CardHeader className={cn("flex items-center justify-between gap-2", isFailed && "border-red-900/60")}>
          <div>
            <div className={cn("text-sm font-medium capitalize", isFailed ? "text-red-400" : "text-zinc-100")}>{status.replaceAll("_", " ")}</div>
            <div className={cn("text-xs", isFailed ? "text-red-400/70" : "text-zinc-500")}>{columnTasks.length} task(s)</div>
          </div>
          {status === "backlog" ? (
            <Button variant="outline" size="sm" onClick={() => onNewTask()}>
              <Plus className="h-4 w-4" />
            </Button>
          ) : null}
        </CardHeader>
        <CardBody className={cn("min-h-[96px] space-y-2 rounded-b-xl transition-colors", isOver && "bg-zinc-900/40")}>
          {columnTasks.map((task) => (
            <TaskCard key={task.id} task={task} tasks={tasks} agents={agents} onOpen={onOpenTask} />
          ))}
          {columnTasks.length === 0 ? (
            <div
              className={cn(
                "rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-sm text-zinc-500 transition-colors",
                isOver && (isFailed ? "border-red-500/50 text-red-400/80" : "border-amber-500/50 text-zinc-400")
              )}
            >
              No tasks here.
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

function TaskCard({
  task,
  tasks,
  agents,
  onOpen,
}: {
  task: Task;
  tasks: Task[];
  agents: Agent[];
  onOpen: (taskId: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { taskId: task.id, status: task.status },
  });
  const isFailed = task.status === "failed";

  return (
    <button
      ref={setNodeRef}
      type="button"
      data-task-id={task.id}
      data-task-status={task.status}
      onClick={() => onOpen(task.id)}
      className={cn(
        "group w-full cursor-grab touch-none rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-left transition-colors active:cursor-grabbing hover:border-amber-500/40 hover:bg-zinc-900/80",
        isFailed && "border-red-900/40 hover:border-red-500/50",
        isDragging && "opacity-30"
      )}
      style={
        transform
          ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
          : undefined
      }
      {...listeners}
      {...attributes}
    >
      <TaskCardContent task={task} tasks={tasks} agents={agents} isFailed={isFailed} />
    </button>
  );
}

function TaskCardPreview({ task, tasks, agents }: { task: Task; tasks: Task[]; agents: Agent[] }) {
  const isFailed = task.status === "failed";
  return (
    <div
      className={cn(
        "w-[256px] cursor-grabbing rounded-xl border border-amber-500/50 bg-zinc-950 p-3 text-left shadow-2xl shadow-black/50",
        isFailed && "border-red-500/50"
      )}
    >
      <TaskCardContent task={task} tasks={tasks} agents={agents} isFailed={isFailed} />
    </div>
  );
}

function TaskCardContent({
  task,
  tasks,
  agents,
  isFailed,
}: {
  task: Task;
  tasks: Task[];
  agents: Agent[];
  isFailed: boolean;
}) {
  const childCount = tasks.filter((child) => child.parent_task_id === task.id).length;

  return (
    <>
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
    </>
  );
}
