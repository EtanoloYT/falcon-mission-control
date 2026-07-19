"use client";

import { useEffect, useState } from "react";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, Boxes, Settings2, Users, Monitor, ShieldCheck, LogOut, Wifi, WifiOff } from "lucide-react";

import { LiveEventsProvider, useLiveEvents } from "@/components/live-events-provider";
import { Badge, Button, Card, Drawer } from "@/components/ui";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: Monitor },
  { href: "/projects", label: "Projects", icon: Boxes },
  { href: "/agents", label: "Agents", icon: Users },
  { href: "/events", label: "Events", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

function ShellChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { connected, latestEvent } = useLiveEvents();
  const [sessionReady, setSessionReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [showGatewayDrawer, setShowGatewayDrawer] = useState(false);
  const [gatewayStatus, setGatewayStatus] = useState<{ reachable: boolean; uptime?: number; reason?: string } | null>(null);
  const [gatewayError, setGatewayError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      if (pathname === "/login") {
        setAuthenticated(false);
        setSessionReady(true);
        return;
      }

      try {
        const response = await fetch("/api/auth/session", { credentials: "include" });
        const payload = (await response.json()) as { ok: boolean; data?: { authenticated?: boolean } };
        const isAuthed = Boolean(payload.ok && payload.data?.authenticated);
        setAuthenticated(isAuthed);
        if (!isAuthed) {
          router.replace("/login");
          return;
        }
      } catch {
        setAuthenticated(false);
        router.replace("/login");
        return;
      } finally {
        setSessionReady(true);
      }
    })();
  }, [pathname, router]);

  useEffect(() => {
    if (pathname === "/login") {
      return;
    }

    const loadGatewayHealth = async () => {
      try {
        const response = await fetch("/api/health", { credentials: "include" });
        const payload = (await response.json()) as { ok: boolean; gateway?: { reachable: boolean; uptime?: number; reason?: string }; error?: string };
        if (!response.ok || !payload.ok || !payload.gateway) {
          setGatewayError(payload.error ?? "Unable to fetch gateway health");
          return;
        }

        setGatewayError(payload.gateway.reason ?? null);
        setGatewayStatus(payload.gateway);
      } catch {
        setGatewayError("Gateway health check failed");
      }
    };

    void loadGatewayHealth();
    const interval = setInterval(() => {
      void loadGatewayHealth();
    }, 15000);

    return () => clearInterval(interval);
  }, [pathname]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.replace("/login");
    router.refresh();
  }

  if (pathname === "/login") {
    return <div className="min-h-screen bg-[#0a0a0a] text-zinc-100">{children}</div>;
  }

  if (!sessionReady || !authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] text-zinc-400">
        <div className="text-sm">Checking session...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100">
      <div className="grid min-h-screen grid-cols-[250px_1fr]">
        <aside className="border-r border-zinc-800 bg-[#090909] px-4 py-4">
          <div className="mb-6 flex items-center gap-3 px-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-wide text-zinc-50">Falcon Mission Control</div>
              <div className="text-xs text-zinc-500">Local-first operator console</div>
            </div>
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                    active ? "bg-zinc-900 text-amber-400" : "text-zinc-300 hover:bg-zinc-900/70 hover:text-zinc-100"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <Card className="mt-6 border-zinc-800 bg-zinc-950/50 p-3">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>Gateway</span>
              <Badge className={cn("border-none", gatewayStatus?.reachable ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300")}>{gatewayStatus?.reachable ? "Online" : "Offline"}</Badge>
            </div>
            <div className="mt-2 text-xs text-zinc-500">Live stream: {connected ? "connected" : "offline"}</div>
            <button type="button" className="mt-3 text-xs text-amber-400 hover:text-amber-300" onClick={() => setShowGatewayDrawer(true)}>
              Show diagnostics
            </button>
          </Card>
        </aside>

        <div className="flex min-h-screen min-w-0 flex-col">
          <header className="flex items-center justify-between border-b border-zinc-800 bg-[#0c0c0c]/90 px-5 py-3 backdrop-blur">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Falcon control surface</div>
              <div className="text-sm text-zinc-300">Dashboard, projects, agents, events, settings</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={gatewayStatus?.reachable ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}>
                {gatewayStatus?.reachable ? <Wifi className="mr-1 h-3 w-3" /> : <WifiOff className="mr-1 h-3 w-3" />}
                {gatewayStatus?.reachable ? "Gateway Online" : "Gateway Offline"}
              </Badge>
              <Button variant="outline" size="sm" onClick={() => setShowGatewayDrawer(true)}>Diagnostics</Button>
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                <LogOut className="h-4 w-4" /> Logout
              </Button>
            </div>
          </header>

          <main className="min-w-0 flex-1 overflow-x-hidden p-5">{children}</main>
        </div>
      </div>

      <Drawer open={showGatewayDrawer} title="OpenClaw diagnostics" onClose={() => setShowGatewayDrawer(false)}>
        <div className="space-y-4 text-sm">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Gateway URL</div>
            <div className="mt-1 text-zinc-200">{process.env.NEXT_PUBLIC_OPENCLAW_GATEWAY_URL ?? "Configured server-side only"}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Current status</div>
            <div className="mt-1 text-zinc-200">{gatewayStatus?.reachable ? "reachable" : "unreachable"}</div>
            {typeof gatewayStatus?.uptime === "number" ? <div className="text-zinc-500">Uptime: {gatewayStatus.uptime} ms</div> : null}
            {gatewayStatus?.reason ? <div className="text-zinc-500">Reason: {gatewayStatus.reason}</div> : null}
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">SSE</div>
            <div className="mt-1 text-zinc-200">{connected ? "connected" : "disconnected"}</div>
            <div className="text-zinc-500">Latest event: {latestEvent?.kind ?? "none"}</div>
          </div>
          {gatewayError ? (
            <div className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-3 text-rose-300">{gatewayError}</div>
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-zinc-300">
              If gateway is offline: verify OPENCLAW_GATEWAY_URL, OPENCLAW_GATEWAY_TOKEN, and OpenClaw policy allowlist.
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <LiveEventsProvider>
      <ShellChrome>{children}</ShellChrome>
    </LiveEventsProvider>
  );
}
