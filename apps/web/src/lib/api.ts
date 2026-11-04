export class ApiError extends Error {
  status: number;
  code: string | null;
  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export type ApiInit = Omit<RequestInit, "body"> & { body?: unknown };

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1] ?? "") : null;
}

async function realFetch(path: string, init: ApiInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  let body: BodyInit | undefined;
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }
  if (method !== "GET" && method !== "HEAD") {
    // CSRF: custom header (blocked cross-site without CORS) + double-submit cookie when present.
    headers.set("x-requested-with", "nodewatch");
    const token = readCookie("nw_csrf") ?? readCookie("csrf");
    if (token) headers.set("x-csrf-token", token);
  }
  return fetch(`/api${path}`, { ...init, method, headers, body, credentials: "same-origin" });
}

/** JSON request against /api. Mock mode swaps the transport; it is compiled out of production builds. */
export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  let res: Response;
  if (import.meta.env.VITE_MOCK === "1") {
    const { mockFetch } = await import("../mock/handler");
    res = await mockFetch(path, init);
  } else {
    res = await realFetch(path, init);
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const msg =
      (typeof obj.message === "string" && obj.message) ||
      (typeof obj.error === "string" && obj.error) ||
      (typeof data === "string" && data) ||
      res.statusText ||
      `Request failed (${res.status})`;
    const code = typeof obj.code === "string" ? obj.code : null;
    throw new ApiError(res.status, msg, code);
  }
  return data as T;
}

export const isUnauthorized = (e: unknown) => e instanceof ApiError && e.status === 401;
export const isForbidden = (e: unknown) => e instanceof ApiError && e.status === 403;

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return "Your role does not allow this action.";
    if (e.status === 429) return "Too many attempts. Wait a minute and try again.";
    if (e.status >= 500) return `Server error: ${e.message}`;
    return e.message;
  }
  if (e instanceof TypeError) return "Cannot reach the Nodewatch server. Check the connection and try again.";
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
