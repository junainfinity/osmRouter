"use client";

export type ApiError = {
  status: number;
  code: string;
  message: string;
  request_id?: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";

let csrfToken: string | null = null;

export function setCSRFToken(t: string) {
  csrfToken = t;
}
export function getCSRFToken() {
  return csrfToken;
}

export async function fetchCSRF() {
  const res = await fetch(`${API_BASE}/api/v1/csrf`, { credentials: "include" });
  if (!res.ok) throw await toApiError(res);
  const body = (await res.json()) as { csrf_token: string };
  csrfToken = body.csrf_token;
  return body.csrf_token;
}

export async function api<T = unknown>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers ?? {}),
  };
  if (method !== "GET" && csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) throw await toApiError(res);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return undefined as T;
  return (await res.json()) as T;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string; request_id?: string } } = {};
  try {
    body = await res.json();
  } catch { /* not json */ }
  return {
    status: res.status,
    code: body.error?.code ?? "UNKNOWN",
    message: body.error?.message ?? res.statusText ?? "Request failed",
    request_id: body.error?.request_id,
  };
}
