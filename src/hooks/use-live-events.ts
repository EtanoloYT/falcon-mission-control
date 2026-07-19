"use client";

import { useEffect, useState } from "react";

import type { Event } from "@/lib/schemas";

export type LiveEvent = Event;

export function useLiveEvents(onEvent?: (event: LiveEvent) => void) {
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
        onEvent?.(event);
      } catch {
        // ignore malformed stream frames
      }
    };

    return () => {
      source.close();
    };
  }, [onEvent]);

  return { connected, events, latestEvent };
}
