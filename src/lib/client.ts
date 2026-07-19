function handleUnauthorized(status: number) {
  if (typeof window !== "undefined" && status === 401 && !window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
  });
  const payload = (await response.json()) as { ok: boolean; data?: T; error?: string };

  if (!response.ok || !payload.ok) {
    handleUnauthorized(response.status);
    throw new Error(payload.error ?? `Request failed with ${response.status}`);
  }

  return payload.data as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as { ok: boolean; data?: T; error?: string };

  if (!response.ok || !payload.ok) {
    handleUnauthorized(response.status);
    throw new Error(payload.error ?? `Request failed with ${response.status}`);
  }

  return payload.data as T;
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as { ok: boolean; data?: T; error?: string };

  if (!response.ok || !payload.ok) {
    handleUnauthorized(response.status);
    throw new Error(payload.error ?? `Request failed with ${response.status}`);
  }

  return payload.data as T;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: "DELETE",
    credentials: "include",
  });
  const payload = (await response.json()) as { ok: boolean; data?: T; error?: string };

  if (!response.ok || !payload.ok) {
    handleUnauthorized(response.status);
    throw new Error(payload.error ?? `Request failed with ${response.status}`);
  }

  return payload.data as T;
}
