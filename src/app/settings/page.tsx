import { Shield, KeyRound, ServerCog } from "lucide-react";

import { Badge, Card, CardBody, CardHeader, Button } from "@/components/ui";
import { maskApiKey } from "@/lib/auth";

export default function SettingsPage() {
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789";
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN ?? "";
  const mcApiKey = process.env.MC_API_KEY ?? "";

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Settings</div>
        <h1 className="text-2xl font-semibold text-zinc-50">Connection and secret controls</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader className="flex items-center justify-between">
            <div className="text-sm font-medium text-zinc-100">Gateway URL</div>
            <ServerCog className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardBody className="space-y-2">
            <div className="text-sm text-zinc-300">{gatewayUrl}</div>
            <Badge>Server-side only</Badge>
          </CardBody>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader className="flex items-center justify-between">
            <div className="text-sm font-medium text-zinc-100">Gateway token</div>
            <KeyRound className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardBody className="space-y-2">
            <div className="font-mono text-sm text-zinc-300">{maskApiKey(gatewayToken) ?? "not set"}</div>
            <Button variant="outline" size="sm" type="button" disabled>
              Regenerate
            </Button>
          </CardBody>
        </Card>

        <Card className="border-zinc-800 bg-zinc-950/70">
          <CardHeader className="flex items-center justify-between">
            <div className="text-sm font-medium text-zinc-100">MC API key</div>
            <Shield className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardBody className="space-y-2">
            <div className="font-mono text-sm text-zinc-300">{maskApiKey(mcApiKey) ?? "generated on first run"}</div>
            <Button variant="outline" size="sm" type="button" disabled>
              Regenerate
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
