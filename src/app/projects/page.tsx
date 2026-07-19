"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useLiveEvents } from "@/components/live-events-provider";
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, Modal, Textarea } from "@/components/ui";
import { apiGet, apiPost } from "@/lib/client";
import type { Project, Task } from "@/lib/schemas";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const { latestEvent } = useLiveEvents();

  const load = async () => {
    const [nextProjects, nextTasks] = await Promise.all([apiGet<Project[]>("/api/projects"), apiGet<Task[]>("/api/tasks")]);
    setProjects(nextProjects);
    setTasks(nextTasks);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!latestEvent) {
      return;
    }

    void load();
  }, [latestEvent]);

  const taskStats = useMemo(() => {
    return new Map(
      projects.map((project) => {
        const projectTasks = tasks.filter((task) => task.project_id === project.id);
        const done = projectTasks.filter((task) => task.status === "done").length;
        return [project.id, { total: projectTasks.length, done }];
      })
    );
  }, [projects, tasks]);

  const createProject = async () => {
    await apiPost("/api/projects", { name, description });
    setName("");
    setDescription("");
    setShowCreate(false);
    await load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Projects</div>
          <h1 className="text-2xl font-semibold text-zinc-50">Active project briefs and boards</h1>
        </div>
        <Button onClick={() => setShowCreate(true)}>New project</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          <Card className="border-zinc-800 bg-zinc-950/70">
            <CardBody className="text-sm text-zinc-500">Loading projects...</CardBody>
          </Card>
        ) : projects.length === 0 ? (
          <Card className="border-dashed border-zinc-800 bg-zinc-950/70">
            <CardBody className="text-sm text-zinc-500">Create a project to start delegating work to agents.</CardBody>
          </Card>
        ) : (
          projects.map((project) => {
            const stats = taskStats.get(project.id) ?? { total: 0, done: 0 };
            const progress = stats.total === 0 ? 0 : Math.round((stats.done / stats.total) * 100);
            return (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <Card className="h-full border-zinc-800 bg-zinc-950/70 transition-colors hover:border-amber-500/40 hover:bg-zinc-900/70">
                  <CardHeader className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-zinc-100">{project.name}</div>
                      <div className="text-xs text-zinc-500">{project.description || "No brief yet."}</div>
                    </div>
                    <Badge>{project.status}</Badge>
                  </CardHeader>
                  <CardBody>
                    <div className="h-2 rounded-full bg-zinc-900">
                      <div className="h-2 rounded-full bg-amber-500" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                      <span>{stats.done} done</span>
                      <span>{stats.total} tasks</span>
                    </div>
                  </CardBody>
                </Card>
              </Link>
            );
          })
        )}
      </div>

      <Modal
        open={showCreate}
        title="New project"
        onClose={() => setShowCreate(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowCreate(false)} type="button">
              Cancel
            </Button>
            <Button onClick={() => void createProject()} type="button" disabled={!name.trim()}>
              Create project
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Launch Falcon UI" />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={8} className="font-mono" placeholder="Project brief for the CEO..." />
          </div>
        </div>
      </Modal>
    </div>
  );
}
