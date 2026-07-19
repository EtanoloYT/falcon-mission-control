"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";

import Link from "next/link";
import { Activity, ArrowRight, Bot, CheckCircle2, CircleSlash, Monitor } from "lucide-react";

import { EventRow } from "@/components/event-row";
import { useLiveEvents } from "@/components/live-events-provider";
import { Badge, Button, Card, CardBody, CardHeader, Skeleton } from "@/components/ui";
import { apiGet } from "@/lib/client";
import { cn } from "@/lib/utils";
import type { Agent, Event, Project, Task } from "@/lib/schemas";

type DashboardState = {
  gateway: { reachable: boolean; uptime?: number } | null;
  projects: Project[];
  agents: Agent[];
  runningTasks: Task[];
  events: Event[];
};

const emptyState: DashboardState = {
  gateway: null,
  projects: [],
  agents: [],
  runningTasks: [],
  events: [],
};

const dashboardRefreshKinds = new Set([
  "project.created",
  "project.updated",
  "project.deleted",
  "agent.created",
  "agent.updated",
  "agent.deleted",
  "agent.status",
  "task.created",
  "task.updated",
  "task.deleted",
  "task.comment",
]);

function countActiveAgents(agents: Agent[]) {
  return agents.filter((agent) => ["idle", "busy"].includes(agent.status)).length;
}

export default function Home() {
  const [state, setState] = useState<DashboardState>(emptyState);
  const [loading, setLoading] = useState(true);
  const { latestEvent } = useLiveEvents();

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const [gateway, projects, agents, runningTasks, events] = await Promise.all([
          apiGet<{ ok: true; gateway: { reachable: boolean; uptime?: number } }>("/api/health"),
          apiGet<Project[]>("/api/projects"),
          apiGet<Agent[]>("/api/agents/flat"),
          apiGet<Task[]>("/api/tasks?status=in_progress"),
          apiGet<Event[]>("/api/events?limit=30"),
        ]);

        if (mounted) {
          setState({
            gateway: gateway.gateway,
            projects,
            agents,
            runningTasks,
            events,
          });
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!latestEvent || !dashboardRefreshKinds.has(latestEvent.kind)) {
      return;
    }

    void (async () => {
      const [gateway, projects, agents, runningTasks, events] = await Promise.all([
        apiGet<{ ok: true; gateway: { reachable: boolean; uptime?: number } }>("/api/health"),
        apiGet<Project[]>("/api/projects"),
        apiGet<Agent[]>("/api/agents/flat"),
        apiGet<Task[]>("/api/tasks?status=in_progress"),
        apiGet<Event[]>("/api/events?limit=30"),
      ]);

      setState({
        gateway: gateway.gateway,
        projects,
        agents,
        runningTasks,
        events,
      });
    })();
  }, [latestEvent]);

  const activeAgents = countActiveAgents(state.agents);
  const last24hEvents = useMemo(() => state.events.filter((event) => event.ts >= Date.now() - 24 * 60 * 60 * 1000), [state.events]);

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Gateway"
          value={state.gateway?.reachable ? "Online" : "Offline"}
          description={state.gateway?.reachable ? "OpenClaw gateway reachable" : "Gateway unavailable"}
          icon={state.gateway?.reachable ? Monitor : CircleSlash}
          accent={state.gateway?.reachable ? "text-emerald-300" : "text-rose-300"}
          loading={loading}
        />
        <StatCard title="Active agents" value={String(activeAgents)} description="idle + busy" icon={Bot} loading={loading} />
        <StatCard title="Running tasks" value={String(state.runningTasks.length)} description="in progress" icon={CheckCircle2} loading={loading} />
        <StatCard title="Last 24h events" value={String(last24hEvents.length)} description="live updates" icon={Activity} loading={loading} />
      </section>

      <section className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card className="min-w-0 border-zinc-800 bg-zinc-950/70">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-zinc-100">Projects</div>
              <div className="text-xs text-zinc-500">Active work and delivery progress</div>
            </div>
            <Link href="/projects" className="shrink-0">
              <Button variant="outline" size="sm">
                View all <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardBody className="grid gap-3 sm:grid-cols-2">
            {loading ? (
              Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-32" />)
            ) : state.projects.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-sm text-zinc-500">Create a project to start tracking work.</div>
            ) : (
              state.projects.map((project) => (
                <ProjectCard key={project.id} project={project} taskCount={state.runningTasks.filter((task) => task.project_id === project.id).length} />
              ))
            )}
          </CardBody>
        </Card>

        <Card className="min-w-0 border-zinc-800 bg-zinc-950/70">
          <CardHeader>
            <div className="text-sm font-medium text-zinc-100">Live feed</div>
            <div className="text-xs text-zinc-500">Reverse chron, powered by SSE</div>
          </CardHeader>
          <CardBody className="min-w-0 space-y-2">
            {state.events.slice(0, 30).map((event) => (
              <EventRow key={event.id} event={event} compact />
            ))}
            {state.events.length === 0 && !loading ? <div className="text-sm text-zinc-500">No events yet.</div> : null}
          </CardBody>
        </Card>
      </section>

      <Card className="border-zinc-800 bg-zinc-950/70">
        <CardHeader>
          <div className="text-sm font-medium text-zinc-100">Agents</div>
          <div className="text-xs text-zinc-500">Compact tree view</div>
        </CardHeader>
        <CardBody>{state.agents.length === 0 ? <div className="text-sm text-zinc-500">Create your CEO agent to start the tree.</div> : <AgentTree agents={state.agents} />}</CardBody>
      </Card>
    </div>
  );
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  accent = "text-zinc-100",
  loading,
}: {
  title: string;
  value: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  accent?: string;
  loading: boolean;
}) {
  return (
    <Card className="border-zinc-800 bg-zinc-950/70">
      <CardBody className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">{title}</div>
          {loading ? <Skeleton className="mt-2 h-8 w-24" /> : <div className={cn("mt-2 text-3xl font-semibold", accent)}>{value}</div>}
          <div className="mt-1 text-xs text-zinc-500">{description}</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3 text-zinc-300">
          <Icon className="h-5 w-5" />
        </div>
      </CardBody>
    </Card>
  );
}

function ProjectCard({ project, taskCount }: { project: Project; taskCount: number }) {
  return (
    <Link href={`/projects/${project.id}`} className="group block">
      <div className="h-full min-w-0 rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 transition-colors group-hover:border-amber-500/40 group-hover:bg-zinc-900/80">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-zinc-100">{project.name}</div>
            <div className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{project.description || "No project brief yet."}</div>
          </div>
          <Badge className="shrink-0">{project.status}</Badge>
        </div>
        <div className="mt-4 h-2 rounded-full bg-zinc-900">
          <div className="h-2 rounded-full bg-amber-500" style={{ width: `${Math.min(100, taskCount * 20)}%` }} />
        </div>
        <div className="mt-2 text-xs text-zinc-500">{taskCount} active task(s)</div>
      </div>
    </Link>
  );
}

function AgentTree({ agents }: { agents: Agent[] }) {
  const roots = agents.filter((agent) => agent.parent_id === null);

  return (
    <div className="space-y-2 text-sm">
      {roots.map((agent) => (
        <AgentBranch key={agent.id} agent={agent} agents={agents} />
      ))}
    </div>
  );
}

function AgentBranch({ agent, agents }: { agent: Agent; agents: Agent[] }) {
  const children = agents.filter((entry) => entry.parent_id === agent.id);
  return (
    <div className="space-y-2">
      <Link href="/agents" className="block rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-200 hover:border-amber-500/40">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="font-medium">{agent.name}</span>
          </div>
          <Badge>{agent.role}</Badge>
        </div>
      </Link>
      {children.length > 0 ? (
        <div className="border-l border-zinc-800 pl-4">
          {children.map((child) => (
            <AgentBranch key={child.id} agent={child} agents={agents} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
