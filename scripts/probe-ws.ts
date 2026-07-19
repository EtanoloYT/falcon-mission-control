import WebSocket from "ws";

const TOKEN = "689c52dbfc8a86c3caf57ebf659d4d2f5d311cfa124b6b96";
const URL = "ws://127.0.0.1:18789";

const ws = new WebSocket(URL, {
  headers: { Authorization: `Bearer ${TOKEN}`, Origin: "http://127.0.0.1:18789" },
});

let nextId = 1;
const pending = new Map<string, (frame: any) => void>();

function send(method: string, params: Record<string, unknown>) {
  const id = `req-${nextId++}`;
  ws.send(JSON.stringify({ type: "req", id, method, params }));
  return new Promise<any>((resolve) => pending.set(id, resolve));
}

ws.on("open", () => {
  console.log("[open]");
  ws.send(
    JSON.stringify({
      type: "req",
      id: "connect-1",
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: { id: "openclaw-probe", version: "0.1.0", platform: "node", mode: "webchat" },
        role: "operator",
        scopes: ["operator.admin", "operator.write", "operator.read"],
        caps: [],
        commands: [],
        permissions: {},
        auth: { token: TOKEN },
        locale: "en-US",
        userAgent: "falcon-mc/0.1.0",
      },
    })
  );
});

ws.on("message", async (raw) => {
  const text = raw.toString();
  console.log("[recv]", text.slice(0, 5000));
  let frame: any;
  try {
    frame = JSON.parse(text);
  } catch {
    return;
  }

  if (frame.id && pending.has(frame.id)) {
    pending.get(frame.id)!(frame);
    pending.delete(frame.id);
  }

  if (frame.id === "connect-1" && (frame.type === "res" || frame.method === "hello-ok")) {
    const cfg = await send("config.get", {});
    console.log("[config.get keys]", cfg?.payload ? Object.keys(cfg.payload) : cfg);
    if (cfg?.payload?.hash) {
      console.log("[hash]", cfg.payload.hash);
      const currentList = cfg.payload?.config?.agents?.list ?? [];
      console.log("[current agents]", currentList.map((a: any) => a.id).join(", "));
    }
    setTimeout(() => process.exit(0), 1500);
  }
});

ws.on("error", (e) => console.error("[err]", e.message));
ws.on("close", (c, r) => console.log("[close]", c, r.toString()));
