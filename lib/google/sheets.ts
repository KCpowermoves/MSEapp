import { env } from "@/lib/env";
import { getSheetsClient } from "@/lib/google/auth";
import {
  kvBumpVersion,
  kvConfigured,
  kvGetJson,
  kvGetVersion,
  kvSetJson,
} from "@/lib/kv";

export const TABS = {
  techs: "Techs",
  jobs: "Jobs",
  dispatches: "Dispatches",
  unitsServiced: "Units Serviced",
  additionalServices: "Additional Services",
  payAttribution: "Pay Attribution",
  payRates: "Pay Rates",
  payCalc: "Pay Calc",
  locationEvents: "Location Events",
  // Payroll layer — periods are slices of time the admin runs a
  // payroll across; adjustments are the audit-tracked corrections
  // that ride alongside the Pay Attribution rows.
  payrollPeriods: "Payroll Periods",
  payrollAdjustments: "Payroll Adjustments",
  // Energy walkthrough audit — one row per job in `audits`, one row
  // per surveyed asset in `auditItems`. Photos live in an `Audit/`
  // subfolder inside each job's existing Drive folder.
  audits: "Audits",
  auditItems: "Audit Items",
  // Append-only audit trail of admin "View as Joe W" sessions.
  impersonationLog: "Impersonation Log",
  // Append-only trail of every photo that reaches Drive — written the
  // moment the Drive upload succeeds, BEFORE the sheet-cell write. If
  // a cell write fails or gets clobbered, the log row still proves the
  // photo exists and where it was meant to go. Appends are atomic in
  // the Sheets API, so this tab cannot lose rows to races.
  photoLog: "Photo Log",
  // Append-only trail of every admin payroll action (period status
  // changes, adjustment create/void/link, overrides, reopens).
  payrollLog: "Payroll Log",
  // Engineering preliminary energy audits / calculator projects.
  engineeringProjects: "Engineering Projects",
  // Dispatch calendar — planned visits (job + date + crew). A visit is
  // a plan; a Dispatches row is what actually happened on site.
  schedule: "Schedule",
  // Sales leads — one row per prospective customer. A signed agreement
  // converts a lead into a Jobs row (self-sold to the agent).
  leads: "Leads",
  // Prospect list — admin-uploaded rows a sales rep can pick from to
  // prefill a New Lead. Consumed (marked Used) when a lead is made.
  prospects: "Prospects",
} as const;

// Short-TTL cache to dedupe reads within a single request and across
// rapid back-to-back requests. Sheets API enforces 60 reads/min/user.
// Without this cache, multi-step flows (e.g. submit dispatch reads
// jobs + dispatches + units + services + tech list in seconds) blow
// past quota and start returning 429.
interface CacheEntry {
  data: string[][];
  expires: number;
  inflight?: Promise<string[][]>;
}
const readCache = new Map<string, CacheEntry>();

// Two-layer cache.
//
// L1 (this Map) is per serverless instance and only dedupes reads
// within a request or a rapid burst. L2 (Redis) is shared by every
// instance, so a write on instance A is seen by B/C/D immediately.
//
// History: L1 alone was capped at 30s because `invalidateCacheForTab`
// could only clear the LOCAL instance — a photo upload on instance A
// left B/C/D serving stale rows until each independently expired
// (techs saw photos "not loading" / slots "clearing"). With L2 doing
// versioned invalidation that hole is closed, so L1 can be short: a
// miss now costs a ~10ms Redis hit instead of a ~500ms Sheets read.
// Without Redis configured we keep the old 30s to avoid hammering the
// Sheets quota (60 reads/min).
const L1_TTL_MS = kvConfigured() ? 10_000 : 30_000;
// Bounds how long an orphaned entry (cached by a read that raced an
// invalidation) can linger under a superseded version key.
const L2_TTL_SECONDS = 300;

function tabFromRange(range: string): string | null {
  const m = range.match(/^['"]?([^'!"]+)['"]?!/);
  return m ? m[1] : null;
}

const versionKey = (tab: string) => `sheetver:${tab}`;
const dataKey = (tab: string, version: number, range: string) =>
  `sheet:${tab}:v${version}:${range}`;

// Per-instance memo of each tab's L2 version so a warm instance doesn't
// pay a Redis round trip for the version on every L1 miss. Short TTL —
// this is the only delay between an invalidation and other instances
// seeing it.
const versionCache = new Map<string, { version: number; expires: number }>();
const VERSION_TTL_MS = 5_000;

async function currentVersion(tab: string): Promise<number> {
  const hit = versionCache.get(tab);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.version;
  const version = await kvGetVersion(versionKey(tab));
  versionCache.set(tab, { version, expires: now + VERSION_TTL_MS });
  return version;
}

/**
 * Drop every cached read for a tab, on this instance AND on all others.
 *
 * Local entries are deleted outright; shared entries are retired by
 * bumping the tab's version counter, which makes every key stamped with
 * the old version unreachable at once (no key enumeration needed). Call
 * this after any write — it is awaited so the next read cannot race
 * ahead of the invalidation.
 */
export async function invalidateCacheForTab(tabName: string): Promise<void> {
  // Bump the shared counter FIRST, then clear local state: if a
  // concurrent read on this instance re-memoizes the version while the
  // bump is in flight, the clears below still wipe it.
  if (kvConfigured()) {
    await kvBumpVersion(versionKey(tabName));
  }
  for (const key of Array.from(readCache.keys())) {
    if (tabFromRange(key) === tabName) readCache.delete(key);
  }
  versionCache.delete(tabName);
}

/** Retry transient Sheets failures (429 quota, 5xx) with backoff.
 *  The service account has a 60 reads/min ceiling; a burst — several
 *  cold instances warming their caches at once — can trip it, and a
 *  single unretried 429 crashes whatever page render triggered the
 *  read ("A server-side exception has occurred"). Two retries with
 *  jittered backoff absorb virtually all of these. */
async function withReadRetry<T>(fn: () => Promise<T>): Promise<T> {
  const RETRY_DELAYS_MS = [600, 1800];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = (e as { code?: number; status?: number })?.code ??
        (e as { status?: number })?.status;
      const retriable =
        status === 429 || (typeof status === "number" && status >= 500);
      if (!retriable || attempt === RETRY_DELAYS_MS.length) throw e;
      const delay = RETRY_DELAYS_MS[attempt] + Math.random() * 400;
      console.warn(
        `[sheets] read got ${status}; retrying in ${Math.round(delay)}ms`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function readRange(
  range: string,
  opts: { fresh?: boolean } = {}
): Promise<string[][]> {
  const now = Date.now();
  if (!opts.fresh) {
    const hit = readCache.get(range);
    if (hit) {
      if (hit.inflight) return hit.inflight;
      if (hit.expires > now) return hit.data;
    }
  } else {
    // Caller asked for a fresh read — drop any cached entry so we
    // don't mask the staleness for concurrent callers either.
    readCache.delete(range);
  }
  const tab = tabFromRange(range);
  const useShared = kvConfigured() && Boolean(tab);

  const inflight = (async () => {
    // L2: another instance may already have paid for this read.
    // Version-stamped, so an invalidation elsewhere is picked up here.
    let version = 0;
    if (useShared && !opts.fresh) {
      version = await currentVersion(tab!);
      const shared = await kvGetJson<string[][]>(dataKey(tab!, version, range));
      if (shared) {
        readCache.set(range, {
          data: shared,
          expires: Date.now() + L1_TTL_MS,
        });
        return shared;
      }
    } else if (useShared) {
      version = await currentVersion(tab!);
    }

    const sheets = getSheetsClient();
    const res = await withReadRetry(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId: env.googleSheetId(),
        range,
        valueRenderOption: "UNFORMATTED_VALUE",
        dateTimeRenderOption: "FORMATTED_STRING",
      })
    );
    const data = (res.data.values ?? []) as string[][];
    readCache.set(range, { data, expires: Date.now() + L1_TTL_MS });
    if (useShared) {
      // Stamped with the version read BEFORE the fetch: if an
      // invalidation landed meanwhile the counter has moved on and this
      // entry is written to a key nobody will read, rather than
      // publishing stale rows under the current version.
      await kvSetJson(dataKey(tab!, version, range), data, L2_TTL_SECONDS);
    }
    return data;
  })().catch((e) => {
    readCache.delete(range);
    throw e;
  });

  readCache.set(range, { data: [], expires: 0, inflight });
  return inflight;
}

export async function readTab(
  tabName: string,
  opts: { fresh?: boolean } = {}
): Promise<string[][]> {
  return readRange(`${tabName}!A2:ZZ`, opts);
}

type InputOption = "USER_ENTERED" | "RAW";

// Tabs we've already verified exist this process — skips the
// spreadsheets.get round-trip on every write after the first.
const knownTabs = new Set<string>();

/**
 * Idempotently make sure a tab exists with the given headers. First
 * call per process does a spreadsheets.get to check; subsequent calls
 * short-circuit via the in-memory cache. Used by the payroll layer so
 * a fresh deployment doesn't fail at first write with "Unable to
 * parse range" — instead we provision the tab on demand.
 */
export async function ensureTabExists(
  tabName: string,
  headerRow: string[]
): Promise<void> {
  if (knownTabs.has(tabName)) return;
  const sheets = getSheetsClient();
  const spreadsheetId = env.googleSheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets ?? []).some(
    (s) => s.properties?.title === tabName
  );
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headerRow] },
    });
    console.log(`[sheets] auto-provisioned tab "${tabName}"`);
  }
  knownTabs.add(tabName);
}

export async function appendRow(
  tabName: string,
  row: (string | number | boolean)[],
  inputOption: InputOption = "USER_ENTERED"
): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: env.googleSheetId(),
    range: `${tabName}!A1`,
    valueInputOption: inputOption,
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
  await invalidateCacheForTab(tabName);
}

/** Append many rows in a single API call — for bulk imports. */
export async function appendRows(
  tabName: string,
  rows: (string | number | boolean)[][],
  inputOption: InputOption = "USER_ENTERED"
): Promise<void> {
  if (rows.length === 0) return;
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: env.googleSheetId(),
    range: `${tabName}!A1`,
    valueInputOption: inputOption,
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
  await invalidateCacheForTab(tabName);
}

export async function updateCell(
  range: string,
  value: string | number | boolean,
  inputOption: InputOption = "USER_ENTERED"
): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: env.googleSheetId(),
    range,
    valueInputOption: inputOption,
    requestBody: { values: [[value]] },
  });
  const tab = tabFromRange(range);
  if (tab) await invalidateCacheForTab(tab);
}

// === Concurrency-safe CSV-cell append ======================================
// Several photo flows store multiple URLs in ONE cell as a comma-joined
// list ("additional" unit photos, service photos, audit schedule photos).
// A naive read-modify-write loses photos two ways:
//   1. Same-instance concurrency: two uploads merge against the same
//      base value; the second write clobbers the first.
//   2. The 30s read cache: the merge base can be stale, silently
//      dropping URLs written by other instances in the window.
// Fix: per-cell in-process mutex (serializes the common same-instance
// case) + always merge against a FRESH single-cell read + verify after
// write and re-merge if another instance clobbered us mid-flight.

const cellLocks = new Map<string, Promise<unknown>>();

async function withCellLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = cellLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  cellLocks.set(key, tail);
  try {
    return await run;
  } finally {
    if (cellLocks.get(key) === tail) cellLocks.delete(key);
  }
}

/**
 * Append `value` to a comma-separated list stored in a single cell,
 * without losing concurrent appends. Values must not contain commas
 * (photo URLs never do). Idempotent — appending a value already in the
 * list is a no-op.
 */
export async function appendCsvValueToCell(opts: {
  tab: string;
  rowIndex: number;
  colLetter: string;
  value: string;
}): Promise<void> {
  const range = `${opts.tab}!${opts.colLetter}${opts.rowIndex}`;
  await withCellLock(range, async () => {
    const MAX_TRIES = 4;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      // Fresh single-cell read — never merge against the shared cache.
      const rows = await readRange(range, { fresh: true });
      const existing = String(rows[0]?.[0] ?? "");
      const parts = existing
        ? existing.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      if (!parts.includes(opts.value)) parts.push(opts.value);
      await updateCell(range, parts.join(", "));

      // Verify our value actually landed. If a writer on another
      // serverless instance clobbered us between read and write, the
      // re-read exposes it and we merge again (now including their value).
      const verify = await readRange(range, { fresh: true });
      const after = String(verify[0]?.[0] ?? "");
      if (after.includes(opts.value)) return;
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 400));
    }
    throw new Error(`CSV cell append failed verification after retries: ${range}`);
  });
}

// Convert column letter to 0-indexed position. "A"→0, "B"→1, ...
function colIndex(letter: string): number {
  return letter.toUpperCase().charCodeAt(0) - "A".charCodeAt(0);
}

export async function findRowIndex(
  tabName: string,
  columnLetter: string,
  matchValue: string
): Promise<number | null> {
  // Use the full-tab read so we share cache with listAll*().
  const rows = await readTab(tabName);
  const col = colIndex(columnLetter);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][col] === matchValue) return i + 2;
  }
  return null;
}

export async function getMaxIdNumber(
  tabName: string,
  columnLetter: string,
  prefix: string
): Promise<number> {
  const rows = await readTab(tabName);
  const col = colIndex(columnLetter);
  let max = 0;
  for (const row of rows) {
    const id = row[col];
    if (typeof id !== "string" || !id.startsWith(prefix)) continue;
    const numPart = id.split("-").at(-1) ?? "";
    const n = parseInt(numPart, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}
