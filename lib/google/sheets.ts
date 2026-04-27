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

export async function readRange(
  range: string
): Promise<string[][]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: env.googleSheetId(),
    range,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  return (res.data.values ?? []) as string[][];
}

export async function readTab(tabName: string): Promise<string[][]> {
  return readRange(`${tabName}!A2:ZZ`);
}

export async function appendRow(
  tabName: string,
  row: (string | number | boolean)[]
): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: env.googleSheetId(),
    range: `${tabName}!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

export async function updateCell(
  range: string,
  value: string | number | boolean
): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: env.googleSheetId(),
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[value]] },
  });
}

export async function findRowIndex(
  tabName: string,
  columnLetter: string,
  matchValue: string
): Promise<number | null> {
  const rows = await readRange(`${tabName}!${columnLetter}2:${columnLetter}`);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === matchValue) return i + 2;
  }
  return null;
}

export async function getMaxIdNumber(
  tabName: string,
  columnLetter: string,
  prefix: string
): Promise<number> {
  const rows = await readRange(`${tabName}!${columnLetter}2:${columnLetter}`);
  let max = 0;
  for (const row of rows) {
    const id = row[0];
    if (typeof id !== "string" || !id.startsWith(prefix)) continue;
    const numPart = id.split("-").at(-1) ?? "";
    const n = parseInt(numPart, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}
