"use client";

import { useEffect, useMemo, useState } from "react";

import { EventRow, eventSearchText } from "@/components/event-row";
import { useLiveEvents } from "@/components/live-events-provider";
import { Card, CardBody, CardHeader, Input, Select } from "@/components/ui";
import { apiGet } from "@/lib/client";
import { cn } from "@/lib/utils";
import { eventKindSchema, type Event } from "@/lib/schemas";

const ALL_KINDS = eventKindSchema.options;

const RANGE_OPTIONS = [
  { label: "Last hour", value: "1" },
  { label: "Last 6 hours", value: "6" },
  { label: "Last 24 hours", value: "24" },
  { label: "Last 7 days", value: "168" },
  { label: "All time", value: "all" },
];

export default function EventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [activeKinds, setActiveKinds] = useState<Set<string>>(new Set(ALL_KINDS));
  const [range, setRange] = useState("24");
  const [search, setSearch] = useState("");
  const { latestEvent } = useLiveEvents();

  const load = async () => {
    const since = range === "all" ? 0 : Date.now() - Number(range) * 60 * 60 * 1000;
    const nextEvents = await apiGet<Event[]>(`/api/events?since=${since}&limit=200`);
    setEvents(nextEvents);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useEffect(() => {
    if (!latestEvent) {
      return;
    }

    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestEvent]);

  const toggleKind = (kind: string) => {
    setActiveKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  };

  const setAllKinds = (on: boolean) => {
    setActiveKinds(on ? new Set(ALL_KINDS) : new Set());
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return events.filter((event) => {
      if (!activeKinds.has(event.kind)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return eventSearchText(event).includes(query);
    });
  }, [events, activeKinds, search]);

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Events</div>
        <h1 className="text-2xl font-semibold text-zinc-50">Live event log</h1>
      </div>

      <Card className="border-zinc-800 bg-zinc-950/70">
        <CardHeader className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Search</div>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search summaries and payloads…"
              />
            </div>
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Time range</div>
              <Select value={range} onChange={(event) => setRange(event.target.value)}>
                {RANGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Kinds</div>
              <div className="flex items-center gap-2 text-[11px]">
                <button type="button" onClick={() => setAllKinds(true)} className="text-zinc-500 hover:text-amber-400">
                  All
                </button>
                <span className="text-zinc-700">/</span>
                <button type="button" onClick={() => setAllKinds(false)} className="text-zinc-500 hover:text-amber-400">
                  None
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_KINDS.map((kind) => {
                const active = activeKinds.has(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => toggleKind(kind)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] transition-colors",
                      active
                        ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                        : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
                    )}
                  >
                    {kind}
                  </button>
                );
              })}
            </div>
          </div>
        </CardHeader>
        <CardBody className="space-y-2">
          <div className="text-xs text-zinc-500">
            {filtered.length} event{filtered.length === 1 ? "" : "s"}
          </div>
          {filtered.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
          {filtered.length === 0 ? <div className="text-sm text-zinc-500">No matching events.</div> : null}
        </CardBody>
      </Card>
    </div>
  );
}
