"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { Button, Card, CardBody, CardHeader, Input, Label } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ apiKey }),
      });

      const payload = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Login failed");
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setError("Unable to reach server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4">
      <Card className="w-full max-w-lg border-zinc-800 bg-zinc-950/80">
        <CardHeader>
          <h1 className="text-lg font-semibold text-zinc-100">Admin Login</h1>
          <p className="text-sm text-zinc-500">Enter your Mission Control admin API key to start a session.</p>
        </CardHeader>
        <CardBody>
          <form className="space-y-4" onSubmit={onSubmit}>
            <label className="block space-y-2">
              <Label>MC API Key</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoFocus
                placeholder="Paste MC_API_KEY"
              />
            </label>
            {error ? <p className="text-sm text-rose-400">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={submitting || !apiKey.trim()}>
              {submitting ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
