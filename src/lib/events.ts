import "server-only";

import { bus } from "@/lib/bus";
import { getDb, mapEvent, now, parseJson, pruneEvents, type EventRow } from "@/lib/db";
import { eventKindSchema, type Event } from "@/lib/schemas";

export function recordEvent(input: { kind: Event["kind"]; payload: unknown }, emitAfterCommit = true) {
  const db = getDb();
  const ts = now();
  const payloadJson = JSON.stringify(input.payload ?? {});
  const result = db
    .prepare("INSERT INTO events (ts, kind, payload_json) VALUES (?, ?, ?)")
    .run(ts, input.kind, payloadJson);
  pruneEvents(db);

  const event: Event = {
    id: Number(result.lastInsertRowid),
    ts,
    kind: input.kind,
    payload: input.payload,
  };

  if (emitAfterCommit) {
    bus.emit("event", event);
  }

  return event;
}

export function emitEvent(event: Event) {
  bus.emit("event", event);
}

export function listEvents(since = 0, limit = 200) {
  const rows = getDb()
    .prepare(
      `SELECT id, ts, kind, payload_json
       FROM events
       WHERE ts >= ?
       ORDER BY ts DESC, id DESC
       LIMIT ?`
    )
    .all(since, limit) as EventRow[];

  return rows.map(mapEvent);
}

export function listRecentEvents(limit = 50) {
  const rows = getDb()
    .prepare(
      `SELECT id, ts, kind, payload_json
       FROM events
       ORDER BY ts DESC, id DESC
       LIMIT ?`
    )
    .all(limit) as EventRow[];

  return rows.map(mapEvent);
}
