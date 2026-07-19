"use client";

import "@xyflow/react/dist/style.css";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { useLiveEvents } from "@/components/live-events-provider";
import { Badge, Button, Card, CardBody, CardHeader, Drawer, Input, Label, Modal, Select, Textarea } from "@/components/ui";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/client";
import { cn } from "@/lib/utils";
import type { Agent, Event, Project, Task } from "@/lib/schemas";
import { Handle, MiniMap, Position, ReactFlow, Background, Controls, type Connection, type Edge, type Node, type NodeProps, useEdgesState, useNodesState } from "@xyflow/react";
import dagre from "dagre";
import { Copy, Download, Moon, Plus, SunMedium, Trash2 } from "lucide-react";

type ImportSummary = {
  imported: number;
  updated: number;
  skipped: number;
  details: Array<{ openclawId: string; name: string; action: "imported" | "updated" | "skipped"; reason?: string }>;
};

type AgentNodeData = {
  agent: Agent;
};

const nodeWidth = 230;
const nodeHeight = 108;

// Staleness thresholds for `agents.last_seen`, in milliseconds.
const FRESHNESS_FRESH_MS = 2 * 60 * 1000; // < 2m: fresh
const FRESHNESS_WARN_MS = 15 * 60 * 1000; // 2m-15m: warn, > 15m: stale
const FRESHNESS_TICK_MS = 30 * 1000; // re-render cadence so relative times stay current
const ACTIVITY_EVENT_LIMIT = 20; // max recent events rendered per agent in the drawer
const EVENT_FETCH_LIMIT = 150; // events pulled from the log before client-side filtering

const roleEmoji: Record<Agent["role"], string> = {
  ceo: "◉",
  manager: "◆",
  coder: "</>",
  reviewer: "✓",
  researcher: "⌕",
  tester: "∴",
  devops: "⚙",
  agent: "•",
};

type Freshness = "fresh" | "warn" | "stale" | "never";

function getFreshness(lastSeen: number | null, nowMs: number): Freshness {
  if (lastSeen === null) return "never";
  const age = nowMs - lastSeen;
  if (age < FRESHNESS_FRESH_MS) return "fresh";
  if (age < FRESHNESS_WARN_MS) return "warn";
  return "stale";
}

const freshnessDotColor: Record<Freshness, string> = {
  fresh: "bg-emerald-400",
  warn: "bg-amber-400",
  stale: "bg-rose-400",
  never: "bg-zinc-700",
};

const freshnessTextColor: Record<Freshness, string> = {
  fresh: "text-emerald-400",
  warn: "text-amber-400",
  stale: "text-rose-400",
  never: "text-zinc-600",
};

function formatRelativeTime(fromMs: number, nowMs: number) {
  const diffSeconds = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (diffSeconds < 5) return "just now";
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function useNowTick(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function FreshnessLabel({ lastSeen, nowMs, className }: { lastSeen: number | null; nowMs: number; className?: string }) {
  const freshness = getFreshness(lastSeen, nowMs);
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium", freshnessTextColor[freshness], className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", freshnessDotColor[freshness])} />
      {lastSeen === null ? "never seen" : formatRelativeTime(lastSeen, nowMs)}
    </span>
  );
}

function AgentNode({ data }: NodeProps) {
  const agent = (data as AgentNodeData).agent;
  const nowMs = useNowTick(FRESHNESS_TICK_MS);
  return (
    <div className="min-w-52.5 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3 shadow-xl shadow-black/20">
      <Handle type="target" position={Position.Top} className="h-2! w-2! border-0! bg-zinc-500!" />
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-sm text-amber-400">
            {roleEmoji[agent.role]}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-zinc-50">{agent.name}</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{agent.status}</div>
            <FreshnessLabel lastSeen={agent.last_seen} nowMs={nowMs} className="mt-0.5" />
          </div>
        </div>
        <div className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", statusColor(agent.status))} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Badge>{agent.role}</Badge>
        <div className="truncate text-[11px] text-zinc-500">{tokenUsage(agent)}</div>
      </div>
      <Handle type="source" position={Position.Bottom} className="h-2! w-2! border-0! bg-zinc-500!" />
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showKeyReveal, setShowKeyReveal] = useState(false);
  const [createdKey, setCreatedKey] = useState<{ agentId: number; key: string } | null>(null);
  const [createForm, setCreateForm] = useState({ name: "", role: "coder", parent_id: "", soul: "" });
  const [details, setDetails] = useState({ soul: "", config: "{}" });
  const [projects, setProjects] = useState<Project[]>([]);
  const [agentTasks, setAgentTasks] = useState<Task[]>([]);
  const [agentEvents, setAgentEvents] = useState<Event[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const { latestEvent } = useLiveEvents();
  const nowMs = useNowTick(FRESHNESS_TICK_MS);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [reparentError, setReparentError] = useState<string | null>(null);

  useEffect(() => {
    if (!reparentError) return;
    const id = setTimeout(() => setReparentError(null), 5000);
    return () => clearTimeout(id);
  }, [reparentError]);

  const load = async () => {
    const nextAgents = await apiGet<Agent[]>("/api/agents/flat");
    setAgents(nextAgents);

    if (selectedAgent) {
      const refreshed = nextAgents.find((agent) => agent.id === selectedAgent.id);
      if (refreshed) {
        setSelectedAgent(refreshed);
      }
    }
  };

  const loadActivity = async (agentId: number) => {
    setActivityLoading(true);
    try {
      const [tasks, events] = await Promise.all([
        apiGet<Task[]>(`/api/tasks?agent_id=${agentId}`),
        apiGet<Event[]>(`/api/events?limit=${EVENT_FETCH_LIMIT}`),
      ]);
      setAgentTasks(tasks);
      setAgentEvents(events.filter((event) => eventInvolvesAgent(event, agentId)).slice(0, ACTIVITY_EVENT_LIMIT));
    } finally {
      setActivityLoading(false);
    }
  };

  useEffect(() => {
    void load();
    void apiGet<Project[]>("/api/projects").then(setProjects);
  }, []);

  useEffect(() => {
    if (!latestEvent) {
      return;
    }

    void load();
  }, [latestEvent]);

  useEffect(() => {
    if (selectedAgent) {
      setDetails({ soul: selectedAgent.soul, config: JSON.stringify(selectedAgent.config, null, 2) });
      void loadActivity(selectedAgent.id);
    } else {
      setAgentTasks([]);
      setAgentEvents([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgent?.id]);

  useEffect(() => {
    if (!latestEvent || !selectedAgent) {
      return;
    }

    if (eventInvolvesAgent(latestEvent, selectedAgent.id)) {
      setAgentEvents((current) => [latestEvent, ...current].slice(0, ACTIVITY_EVENT_LIMIT));
    }
  }, [latestEvent, selectedAgent]);

  const { nodes, edges } = useMemo(() => layoutAgents(agents), [agents]);

  const [nodeState, setNodeState, onNodesChange] = useNodesState(nodes);
  const [edgeState, setEdgeState, onEdgesChange] = useEdgesState(edges);

  useEffect(() => {
    setNodeState(nodes);
    setEdgeState(edges);
  }, [nodes, edges, setNodeState, setEdgeState]);

  async function createAgent() {
    const created = await apiPost<{ agent: Agent; agentKey: string }>("/api/agents", {
      name: createForm.name,
      role: createForm.role,
      parent_id: createForm.parent_id ? Number(createForm.parent_id) : null,
      soul: createForm.soul,
      config: { model: "", capabilities: [] },
    });
    setCreatedKey({ agentId: created.agent.id, key: created.agentKey });
    setShowKeyReveal(true);
    setShowCreate(false);
    setCreateForm({ name: "", role: "coder", parent_id: "", soul: "" });
    await load();
  }

  async function saveSoul() {
    if (!selectedAgent) return;
    const config = safeJson(details.config);
    const updated = await apiPatch<Agent>(`/api/agents/${selectedAgent.id}`, {
      soul: details.soul,
      config,
    });
    setSelectedAgent(updated);
    await load();
  }

  async function wake() {
    if (!selectedAgent) return;
    await apiPost(`/api/agents/${selectedAgent.id}/wake`, {});
    await load();
  }

  async function sleep() {
    if (!selectedAgent) return;
    await apiPost(`/api/agents/${selectedAgent.id}/sleep`, {});
    await load();
  }

  async function remove() {
    if (!selectedAgent) return;
    await apiDelete(`/api/agents/${selectedAgent.id}`);
    setSelectedAgent(null);
    await load();
  }

  async function moveAgent(agentId: number, parentId: number | null) {
    try {
      await apiPost(`/api/agents/${agentId}/move`, { new_parent_id: parentId });
      setReparentError(null);
      await load();
    } catch (err) {
      setReparentError(err instanceof Error ? err.message : "Failed to move agent");
    }
  }

  async function detachAgent() {
    if (!selectedAgent || selectedAgent.parent_id === null) return;
    await moveAgent(selectedAgent.id, null);
  }

  async function importFromOpenclaw() {
    setImporting(true);
    setImportError(null);
    try {
      const summary = await apiPost<ImportSummary>("/api/agents/import");
      setImportSummary(summary);
      await load();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const hasCEO = agents.some((agent) => agent.role === "ceo");
  const sortedAgents = [...agents].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Agents</div>
          <h1 className="text-2xl font-semibold text-zinc-50">Organizational tree</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void importFromOpenclaw()} disabled={importing}>
            <Download className="h-4 w-4" /> {importing ? "Importing…" : "Import from OpenClaw"}
          </Button>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> Add agent
          </Button>
        </div>
      </div>

      {importError ? (
        <Card className="border-rose-900 bg-rose-500/5">
          <CardBody className="text-sm text-rose-300">
            Import failed: {importError}
          </CardBody>
        </Card>
      ) : null}

      {importSummary ? (
        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardBody className="text-sm text-zinc-300">
            Import complete — {importSummary.imported} imported, {importSummary.updated} updated, {importSummary.skipped} skipped.
            <span className="ml-2 text-xs text-zinc-500">
              Imported agents are linked by OpenClaw ID and can be woken or dispatched immediately.
            </span>
          </CardBody>
        </Card>
      ) : null}

      {agents.length === 0 ? (
        <Card className="border-dashed border-zinc-800 bg-zinc-950/70">
          <CardBody className="space-y-3 text-center">
            <div className="text-sm text-zinc-300">No agents yet. Import your existing OpenClaw agents to get started.</div>
            <Button onClick={() => void importFromOpenclaw()} disabled={importing}>
              <Download className="h-4 w-4" /> {importing ? "Importing…" : "Import from OpenClaw"}
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {!hasCEO ? (
        <Card className="border-dashed border-zinc-800 bg-zinc-950/70">
          <CardBody className="space-y-3">
            <div className="text-sm text-zinc-300">Create your CEO agent to unlock the org chart.</div>
            <Button variant="outline" size="sm" onClick={() => {
              setCreateForm((current) => ({ ...current, role: "ceo", name: "Falcon", soul: defaultSoulTemplate() }));
              setShowCreate(true);
            }}>
              Use CEO template
            </Button>
          </CardBody>
        </Card>
      ) : null}

      <Card className="h-[74vh] overflow-hidden border-zinc-800 bg-zinc-950/70">
        <CardHeader className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-zinc-100">React Flow tree</div>
            <div className="text-xs text-zinc-500">
              Drag an agent onto another to make it report to that agent — or draw a line from a parent&apos;s bottom
              handle to a child&apos;s top handle.
            </div>
            {reparentError ? <div className="mt-1 text-xs text-rose-400">{reparentError}</div> : null}
          </div>
          <div className="text-xs text-zinc-500">{agents.length} agent(s)</div>
        </CardHeader>
        <CardBody className="h-[calc(74vh-64px)] p-0">
          <ReactFlow
            nodes={nodeState}
            edges={edgeState}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, node) => {
              const agent = agents.find((entry) => entry.id === Number(node.id));
              if (agent) {
                setSelectedAgent(agent);
              }
            }}
            onConnect={(connection: Connection) => {
              if (!connection.source || !connection.target) {
                return;
              }

              const parentId = Number(connection.source);
              const childId = Number(connection.target);
              const child = agents.find((agent) => agent.id === childId);
              const parent = agents.find((agent) => agent.id === parentId);

              if (!child || !parent) {
                return;
              }

              if (parentId === childId) {
                setReparentError("An agent cannot report to itself.");
                return;
              }

              if (child.parent_id === parentId) {
                return;
              }

              if (wouldCreateCycleClient(agents, childId, parentId)) {
                setReparentError(`Cannot connect — ${parent.name} is already a descendant of ${child.name}.`);
                return;
              }

              void moveAgent(childId, parentId);
            }}
            onNodeDragStop={(_, node) => {
              const target = nearestNode(nodeState, node.id, node.position.x, node.position.y);
              if (target && target.id !== node.id) {
                const movingId = Number(node.id);
                const newParentId = Number(target.id);
                const moving = agents.find((agent) => agent.id === movingId);
                const newParent = agents.find((agent) => agent.id === newParentId);
                if (!moving || !newParent || moving.id === newParentId || moving.parent_id === newParentId) {
                  return;
                }

                if (wouldCreateCycleClient(agents, movingId, newParentId)) {
                  setReparentError(`Cannot move ${moving.name} onto ${newParent.name} — ${newParent.name} is already a descendant of ${moving.name}.`);
                  return;
                }

                void moveAgent(movingId, newParentId);
              }
            }}
            fitView
            attributionPosition="top-right"
          >
            <Background gap={24} color="#1f1f1f" />
            <MiniMap
              zoomable
              pannable
              nodeColor="#27272a"
              nodeStrokeColor="#3f3f46"
              nodeBorderRadius={6}
              maskColor="rgba(10, 10, 10, 0.72)"
              bgColor="#111111"
              style={{ border: "1px solid #222222", borderRadius: 12 }}
            />
            <Controls showInteractive={false} />
          </ReactFlow>
        </CardBody>
      </Card>

      <Drawer
        open={Boolean(selectedAgent)}
        title={selectedAgent ? `${selectedAgent.name} · ${selectedAgent.role}` : "Agent"}
        onClose={() => setSelectedAgent(null)}
        footer={
          selectedAgent ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void wake()}><SunMedium className="h-4 w-4" /> Wake</Button>
              <Button variant="outline" onClick={() => void sleep()}><Moon className="h-4 w-4" /> Sleep</Button>
              {selectedAgent.parent_id !== null ? (
                <Button variant="outline" onClick={() => void detachAgent()}>Detach from parent</Button>
              ) : null}
              <Button variant="danger" onClick={() => void remove()}><Trash2 className="h-4 w-4" /> Delete</Button>
            </div>
          ) : null
        }
      >
        {selectedAgent ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge>{selectedAgent.role}</Badge>
              <Badge>{selectedAgent.status}</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs">
              <span className="uppercase tracking-[0.2em] text-zinc-500">Last seen</span>
              <div className="flex items-center gap-2 text-right">
                <span className="text-zinc-400">{selectedAgent.last_seen === null ? "—" : new Date(selectedAgent.last_seen).toLocaleString()}</span>
                <FreshnessLabel lastSeen={selectedAgent.last_seen} nowMs={nowMs} />
              </div>
            </div>
            <label className="block space-y-2">
              <Label>Soul</Label>
              <Textarea value={details.soul} onChange={(event) => setDetails((current) => ({ ...current, soul: event.target.value }))} rows={12} className="font-mono text-sm" />
            </label>
            <label className="block space-y-2">
              <Label>Config JSON</Label>
              <Textarea value={details.config} onChange={(event) => setDetails((current) => ({ ...current, config: event.target.value }))} rows={10} className="font-mono text-sm" />
            </label>
            <Button variant="outline" className="w-full" onClick={() => void saveSoul()}>
              Save changes
            </Button>
            <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">API key</div>
              <div className="font-mono text-sm text-zinc-300">{selectedAgent.api_key_masked ?? "masked"}</div>
              <div className="text-xs text-zinc-500">Plaintext keys are only shown once on creation.</div>
            </div>

            <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Assigned tasks</div>
                {activityLoading ? <div className="text-[11px] text-zinc-600">loading…</div> : null}
              </div>
              {agentTasks.length === 0 ? (
                <div className="text-sm text-zinc-500">No activity yet.</div>
              ) : (
                <div className="space-y-2">
                  {sortTasksForActivity(agentTasks).map((task) => (
                    <Link
                      key={task.id}
                      href={`/projects/${task.project_id}`}
                      className="block min-w-0 rounded-md border border-zinc-800 bg-zinc-900/60 p-2.5 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 truncate text-sm text-zinc-100">{task.title}</div>
                        <Badge className={task.status === "failed" ? "border-red-900 bg-red-500/10 text-red-400 shrink-0" : "shrink-0"}>{task.status}</Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                        <span className="uppercase tracking-[0.14em]">{task.priority}</span>
                        <span className="truncate">{projectName(projects, task.project_id)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Recent events</div>
              {agentEvents.length === 0 ? (
                <div className="text-sm text-zinc-500">No activity yet.</div>
              ) : (
                <div className="max-h-72 min-w-0 space-y-1.5 overflow-y-auto pr-1">
                  {agentEvents.map((event) => (
                    <div key={event.id} className="min-w-0 rounded-md border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-1.5">
                      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                        <span className="shrink-0">{formatRelativeTime(event.ts, nowMs)}</span>
                        <span className="shrink-0 text-zinc-600">·</span>
                        <span className="shrink-0 uppercase tracking-[0.1em] text-zinc-400">{event.kind}</span>
                      </div>
                      <div className="truncate text-sm text-zinc-300">{summarizeEvent(event)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={showCreate}
        title="Add agent"
        onClose={() => setShowCreate(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowCreate(false)} type="button">
              Cancel
            </Button>
            <Button onClick={() => void createAgent()} type="button" disabled={!createForm.name.trim()}>
              Create agent
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <label className="block space-y-2">
            <Label>Name</Label>
            <Input value={createForm.name} onChange={(event) => setCreateForm((value) => ({ ...value, name: event.target.value }))} placeholder="Falcon" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-2">
              <Label>Role</Label>
              <Select value={createForm.role} onChange={(event) => setCreateForm((value) => ({ ...value, role: event.target.value, soul: event.target.value === "ceo" ? defaultSoulTemplate() : value.soul || "" }))}>
                {(["ceo", "manager", "coder", "reviewer", "researcher", "tester", "devops", "agent"] as const).map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block space-y-2">
              <Label>Parent</Label>
              <Select value={createForm.parent_id} onChange={(event) => setCreateForm((value) => ({ ...value, parent_id: event.target.value }))}>
                <option value="">None</option>
                {sortedAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <label className="block space-y-2">
            <Label>Soul</Label>
            <Textarea value={createForm.soul} onChange={(event) => setCreateForm((value) => ({ ...value, soul: event.target.value }))} rows={12} className="font-mono text-sm" />
          </label>
        </div>
      </Modal>

      <Modal
        open={showKeyReveal && createdKey !== null}
        title="Agent key created"
        onClose={() => setShowKeyReveal(false)}
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setShowKeyReveal(false)}>Done</Button>
          </div>
        }
      >
        {createdKey ? (
          <div className="space-y-3">
            <div className="text-sm text-zinc-300">Copy this now, you cannot see it again.</div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-sm text-zinc-100">{createdKey.key}</div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(createdKey.key);
              }}
            >
              <Copy className="h-4 w-4" /> Copy key
            </Button>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function layoutAgents(agents: Agent[]) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "TB", nodesep: 44, ranksep: 90 });

  const nodes: Node<AgentNodeData>[] = agents.map((agent) => ({
    id: String(agent.id),
    type: "agent",
    position: { x: 0, y: 0 },
    data: { agent },
  }));

  const edges: Edge[] = agents
    .filter((agent) => agent.parent_id !== null)
    .map((agent) => ({
      id: `${agent.parent_id}-${agent.id}`,
      source: String(agent.parent_id),
      target: String(agent.id),
      animated: agent.status === "busy",
      style: { stroke: "#52525b" },
    }));

  nodes.forEach((node) => {
    graph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);

  const positioned = nodes.map((node) => {
    const layoutNode = graph.node(node.id) as { x: number; y: number } | undefined;
    return {
      ...node,
      position: {
        x: (layoutNode?.x ?? 0) - nodeWidth / 2,
        y: (layoutNode?.y ?? 0) - nodeHeight / 2,
      },
    };
  });

  return { nodes: positioned, edges };
}

/**
 * Client-side mirror of the server's `wouldCreateCycle` check in
 * src/lib/store.ts — lets the UI refuse an obviously-invalid reparent
 * immediately instead of round-tripping to the API. The server check
 * remains authoritative.
 */
function wouldCreateCycleClient(agents: Agent[], id: number, newParentId: number): boolean {
  if (id === newParentId) {
    return true;
  }

  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const visited = new Set<number>();
  let cursor: number | null = newParentId;

  while (cursor !== null) {
    if (cursor === id) {
      return true;
    }
    if (visited.has(cursor)) {
      return true;
    }
    visited.add(cursor);
    cursor = byId.get(cursor)?.parent_id ?? null;
  }

  return false;
}

function nearestNode(nodes: Node<AgentNodeData>[], sourceId: string, x: number, y: number) {
  let best: Node<AgentNodeData> | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const node of nodes) {
    if (node.id === sourceId) continue;
    const centerX = node.position.x + nodeWidth / 2;
    const centerY = node.position.y + nodeHeight / 2;
    const distance = Math.hypot(centerX - x, centerY - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }

  return bestDistance < 180 ? best : null;
}

function tokenUsage(agent: Agent) {
  const model = (agent.config as { model?: string }).model;
  return model ? model : "no model";
}

function statusColor(status: Agent["status"]) {
  switch (status) {
    case "idle":
      return "bg-emerald-400";
    case "busy":
      return "bg-amber-400";
    case "sleeping":
      return "bg-zinc-500";
    case "error":
      return "bg-rose-400";
    default:
      return "bg-zinc-700";
  }
}

const TASK_ACTIVITY_ORDER: Record<Task["status"], number> = {
  in_progress: 0,
  assigned: 1,
  review: 2,
  backlog: 3,
  failed: 4,
  done: 5,
};

function sortTasksForActivity(tasks: Task[]) {
  return [...tasks].sort((a, b) => {
    const order = TASK_ACTIVITY_ORDER[a.status] - TASK_ACTIVITY_ORDER[b.status];
    if (order !== 0) return order;
    return b.updated_at - a.updated_at;
  });
}

function projectName(projects: Project[], projectId: number) {
  return projects.find((project) => project.id === projectId)?.name ?? `Project #${projectId}`;
}

type AgentEventPayload = {
  agent?: { id?: number };
  agent_id?: number;
  task?: { id?: number; title?: string; status?: string; assigned_agent_id?: number | null; created_by_agent_id?: number | null };
  task_id?: number;
  comment?: { author_agent_id?: number | null; body?: string };
};

function eventInvolvesAgent(event: Event, agentId: number) {
  const payload = event.payload as AgentEventPayload | null | undefined;
  if (!payload) return false;

  return (
    payload.agent?.id === agentId ||
    payload.agent_id === agentId ||
    payload.task?.assigned_agent_id === agentId ||
    payload.task?.created_by_agent_id === agentId ||
    payload.comment?.author_agent_id === agentId
  );
}

function summarizeEvent(event: Event) {
  const payload = event.payload as AgentEventPayload | null | undefined;

  switch (event.kind) {
    case "task.created":
      return `Task "${payload?.task?.title ?? "untitled"}" created`;
    case "task.updated":
      return `Task "${payload?.task?.title ?? `#${payload?.task?.id ?? "?"}`}" → ${payload?.task?.status ?? "updated"}`;
    case "task.deleted":
      return `Task #${payload?.task_id ?? "?"} deleted`;
    case "task.comment":
      return `Comment on task #${payload?.task_id ?? "?"}${payload?.comment?.body ? `: "${truncate(payload.comment.body, 60)}"` : ""}`;
    case "agent.status":
      return `Status changed to ${(event.payload as { agent?: Agent })?.agent?.status ?? "updated"}`;
    case "agent.created":
      return "Agent created";
    case "agent.updated":
      return "Agent updated";
    case "agent.deleted":
      return "Agent deleted";
    case "heartbeat":
      return "Heartbeat received";
    default:
      return event.kind;
  }
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function safeJson(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function defaultSoulTemplate() {
  return `You are a focused OpenClaw agent in Falcon Mission Control.

Rules:
- Keep task updates concise and actionable.
- Report progress back to Mission Control using the provided API key.
- Ask for clarification only when blocked.
- Prefer small, verifiable steps.
- Maintain professional, compact status updates.`;
}
