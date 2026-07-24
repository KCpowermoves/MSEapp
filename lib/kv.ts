import "server-only";

/**
 * Minimal Upstash / Vercel-KV Redis client over plain fetch.
 *
 * No SDK dependency on purpose: the REST API is two shapes (single
 * command, pipeline) and going direct keeps the serverless bundle small
 * and the failure modes obvious.
 *
 * EVERY operation fails OPEN. Missing config, network error, timeout,
 * or a non-2xx response all return null/false so callers fall through
 * to the source of truth (Google Sheets). A cache outage must never
 * take the app down — the worst it can do is make reads slower.
 */

// Vercel's KV integration and a raw Upstash database use different env
// names for the same pair of values; accept either.
function config(): { url: string; token: string } | null {
  const url =
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "";
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export function kvConfigured(): boolean {
  return config() !== null;
}

// A cache that's slow is worse than no cache — bail out fast and let
// the caller hit Sheets instead of stacking latency.
const TIMEOUT_MS = 1_500;

async function post<T>(path: string, body: unknown): Promise<T | null> {
  const cfg = config();
  if (!cfg) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.url}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[kv] ${path || "command"} → HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    // Abort (timeout) and network errors both land here.
    if ((e as Error)?.name !== "AbortError") {
      console.warn("[kv] request failed:", (e as Error)?.message ?? e);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Run one command, e.g. ["GET", "key"]. Returns the raw result. */
async function command<T>(args: (string | number)[]): Promise<T | null> {
  const body = await post<{ result?: T }>("", args);
  return (body?.result ?? null) as T | null;
}

/** Run several commands in one round trip. Returns raw results in order. */
async function pipeline<T>(cmds: (string | number)[][]): Promise<T[] | null> {
  const body = await post<{ result?: T }[]>("/pipeline", cmds);
  if (!Array.isArray(body)) return null;
  return body.map((r) => (r?.result ?? null) as T);
}

/** GET + JSON.parse. Returns null on miss, malformed JSON, or any error. */
export async function kvGetJson<T>(key: string): Promise<T | null> {
  const raw = await command<string>(["GET", key]);
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** SET key = JSON(value) with a TTL in seconds. Best-effort. */
export async function kvSetJson(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  let payload: string;
  try {
    payload = JSON.stringify(value);
  } catch {
    return;
  }
  // Upstash rejects values over 1MB on the free tier and large payloads
  // are slow to ship anyway — skip rather than fail the request.
  if (payload.length > 900_000) return;
  await command(["SET", key, payload, "EX", ttlSeconds]);
}

/**
 * Read a monotonic version counter. Missing key reads as 0, which is
 * also what a fresh database returns — callers just cache under v0
 * until the first invalidation bumps it.
 */
export async function kvGetVersion(key: string): Promise<number> {
  const raw = await command<string | number>(["GET", key]);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Bump a version counter. Every cache key stamped with the old version
 * becomes unreachable immediately and expires on its own TTL — this is
 * how invalidation reaches every serverless instance at once without
 * enumerating or deleting individual keys.
 */
export async function kvBumpVersion(key: string): Promise<void> {
  await pipeline([
    ["INCR", key],
    // Keep the counter alive well past any data TTL so it never resets
    // backwards while stamped data is still readable.
    ["EXPIRE", key, 60 * 60 * 24 * 30],
  ]);
}
