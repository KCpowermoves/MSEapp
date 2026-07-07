import { env } from "@/lib/env";
import { getSheetsClient } from "@/lib/google/auth";

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
// Rolled back to 30s 2026-06-08 after a tech report of photos "not
// loading" and "slots clearing when I open the job today." Diagnosis:
// `invalidateCacheForTab` only clears the LOCAL Vercel serverless
// instance's cache. When request A handles a photo upload, instance
// A's cache is fresh; instances B/C/D keep serving stale reads from
// their own caches until each independently expires. The 30s window
// limits how stale that can get. A proper fix needs a distributed
// cache (Vercel KV or similar) — until then, keep TTL short.
const CACHE_TTL_MS = 30_000;

function tabFromRange(range: string): string | null {
  const m = range.match(/^['"]?([^'!"]+)['"]?!/);
  return m ? m[1] : null;
}

export function invalidateCacheForTab(tabName: string): void {
  for (const key of Array.from(readCache.keys())) {
    if (tabFromRange(key) === tabName) readCache.delete(key);
  }
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
  const sheets = getSheetsClient();
  const inflight = sheets.spreadsheets.values
    .get({
      spreadsheetId: env.googleSheetId(),
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    })
    .then((res) => {
      const data = (res.data.values ?? []) as string[][];
      readCache.set(range, { data, expires: Date.now() + CACHE_TTL_MS });
      return data;
    })
    .catch((e) => {
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
  invalidateCacheForTab(tabName);
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
  if (tab) invalidateCacheForTab(tab);
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
