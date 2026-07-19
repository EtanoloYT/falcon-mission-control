"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import type { Event } from "@/lib/schemas";

export type LiveEvent = Event;

type LiveEventsContextValue = {
  connected: boolean;
  events: LiveEvent[];
  latestEvent: LiveEvent | null;
};

const LiveEventsContext = createContext<LiveEventsContextValue | null>(null);

export function LiveEventsProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [latestEvent, setLatestEvent] = useState<LiveEvent | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/stream");

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as LiveEvent;
        setLatestEvent(event);
        setEvents((current) => [event, ...current].slice(0, 200));
      } catch {
        // ignore malformed stream frames
      }
    };

    return () => {
      source.close();
    };
  }, []);

  const value = useMemo(() => ({ connected, events, latestEvent }), [connected, events, latestEvent]);

  return <LiveEventsContext.Provider value={value}>{children}</LiveEventsContext.Provider>;
}

export function useLiveEvents() {
  const context = useContext(LiveEventsContext);
  if (!context) {
    throw new Error("useLiveEvents must be used within LiveEventsProvider");
  }

  return context;
}
