// Small fetch helpers with hard timeouts. Never throw anything but Error.

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(new Error(`timeout after ${timeoutMs} ms`)), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (err) {
    const e = err as Error;
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    throw new HttpError(`${redactUrl(url)}: ${cause?.code ?? cause?.message ?? e.message}`, null);
  } finally {
    clearTimeout(t);
  }
}

export async function getJson<T = unknown>(url: string, timeoutMs = 5000, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetchWithTimeout(url, { headers: { accept: "application/json", ...headers } }, timeoutMs);
  const text = await res.text();
  if (!res.ok) throw new HttpError(`${redactUrl(url)}: HTTP ${res.status} ${text.slice(0, 200)}`, res.status);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(`${redactUrl(url)}: invalid JSON`, res.status);
  }
}

export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  timeoutMs = 5000,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: T | string }> {
  const res = await fetchWithTimeout(
    url,
    { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) },
    timeoutMs,
  );
  const text = await res.text();
  let parsed: T | string = text;
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    /* keep text */
  }
  return { status: res.status, body: parsed };
}

let rpcId = 1;
export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
  }
}

/** One JSON-RPC call. Throws RpcError on transport or RPC errors. */
export async function jsonRpc<T = unknown>(url: string, method: string, params: unknown[] = [], timeoutMs = 5000): Promise<T> {
  const { status, body } = await postJson<{ result?: T; error?: { code: number; message: string } }>(
    url,
    { jsonrpc: "2.0", id: rpcId++, method, params },
    timeoutMs,
  );
  if (typeof body === "string") throw new RpcError(`${method}: HTTP ${status} ${body.slice(0, 200)}`, null);
  if (body.error) throw new RpcError(`${method}: ${body.error.message}`, body.error.code);
  if (status >= 400) throw new RpcError(`${method}: HTTP ${status}`, null);
  return body.result as T;
}

/** Hide access keys that live in URL paths (Arkiv puts them as the last path segment) and credentials. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    if (u.pathname.length > 1 && !/^\/(api|eth|v1)\b/.test(u.pathname) && u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
      u.pathname = "/…";
    }
    u.search = "";
    return u.toString();
  } catch {
    return "<url>";
  }
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function withTimeout<T>(p: Promise<T>, ms: number, what = "operation"): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(t);
  }
}
