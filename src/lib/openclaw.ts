import "server-only";

export const openclawToolAllowlist = new Set([
  "sessions_list",
  "session_status",
  "sessions_history",
  "sessions_send",
  "sessions_spawn",
  "agents_list",
]);

export async function invoke<T = unknown>(
  tool: string,
  args: Record<string, unknown>,
  sessionKey?: string
): Promise<T> {
  if (!openclawToolAllowlist.has(tool)) {
    throw new Error("tool not allowed by gateway policy");
  }

  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789";
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!token) {
    throw new Error("OPENCLAW_GATEWAY_TOKEN is missing");
  }

  const response = await fetch(`${gatewayUrl.replace(/\/$/, "")}/tools/invoke`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ tool, args, sessionKey }),
  });

  if (response.status === 404) {
    throw new Error("tool not allowed by gateway policy");
  }

  if (!response.ok) {
    throw new Error(`OpenClaw gateway request failed with ${response.status}`);
  }

  const envelope = (await response.json()) as {
    ok: boolean;
    result?: {
      content?: Array<{ type?: string; text?: string }>;
      details?: unknown;
    };
    error?: string;
  };

  if (!envelope.ok) {
    throw new Error(envelope.error ?? "OpenClaw gateway returned an error");
  }

  const text = envelope.result?.content?.[0]?.text;
  if (!text) {
    return envelope.result?.details as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}
