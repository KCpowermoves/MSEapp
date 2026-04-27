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
const CACHE_TTL_MS = 2500;

function tabFromRange(range: string): string | null {
  const m = range.match(/^['"]?([^'!"]+)['"]?!/);
  return m ? m[1] : null;
}

export function invalidateCacheForTab(tabName: string): void {
  for (const key of Array.from(readCache.keys())) {
    if (tabFromRange(key) === tabName) readCache.delete(key);
  }
}

export async function readRange(range: string): Promise<string[][]> {
  const now = Date.now();
  const hit = readCache.get(range);
  if (hit) {
    if (hit.inflight) return hit.inflight;
    if (hit.expires > now) return hit.data;
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

export async function readTab(tabName: string): Promise<string[][]> {
  return readRange(`${tabName}!A2:ZZ`);
}

type InputOption = "USER_ENTERED" | "RAW";

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
