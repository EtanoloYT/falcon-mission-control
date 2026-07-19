import { bus } from "@/lib/bus";
import { listRecentEvents } from "@/lib/events";

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (value: string) => controller.enqueue(encoder.encode(value));

      const recent = listRecentEvents(50).slice().reverse();
      for (const event of recent) {
        write(`event: replay\n`);
        write(`data: ${JSON.stringify(event)}\n\n`);
      }

      const heartbeat = setInterval(() => {
        write(`: heartbeat ${Date.now()}\n\n`);
      }, 15000);

      const onEvent = (event: unknown) => {
        write(`data: ${JSON.stringify(event)}\n\n`);
      };

      bus.on("event", onEvent);

      const cleanup = () => {
        clearInterval(heartbeat);
        bus.off("event", onEvent);
        controller.close();
      };

      request.signal.addEventListener("abort", cleanup, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
