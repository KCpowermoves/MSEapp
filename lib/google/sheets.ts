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
