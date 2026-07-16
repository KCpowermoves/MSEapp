#!/usr/bin/env node
// One-time schema bump: add FinalizedAt / FinalizedBy / FinalizeNote
// headers to columns R/S/T of the Jobs tab for the payroll worklist's
// force-finalize stamp. Existing rows leave R:T blank, which the data
// layer treats as never force-finalized.
//
// Idempotent — re-running is safe.
//
// Usage: node scripts/add-finalize-columns.mjs

import { google } from "googleapis";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "..", ".env.local") });

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SA_KEY = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "").replace(
  /\\n/g,
  "\n"
);

if (!SHEET_ID || !SA_EMAIL || !SA_KEY) {
  console.error("Missing env vars");
  process.exit(1);
}

const auth = new google.auth.JWT({
  email: SA_EMAIL,
  key: SA_KEY,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

const WANTED = [
  { col: "R", index: 17, name: "FinalizedAt" },
  { col: "S", index: 18, name: "FinalizedBy" },
  { col: "T", index: 19, name: "FinalizeNote" },
];

const res = await sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: "Jobs!A1:Z1",
});
const header = res.data.values?.[0] ?? [];
console.log(`Jobs header has ${header.length} columns: ${header.join(", ")}`);

for (const w of WANTED) {
  const current = header[w.index];
  if (current === w.name) {
    console.log(`Column ${w.col} is already '${w.name}' — skipping.`);
    continue;
  }
  if (current && current !== w.name) {
    console.error(
      `Column ${w.col} is "${current}" — refusing to overwrite. Fix manually.`
    );
    process.exit(1);
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Jobs!${w.col}1`,
    valueInputOption: "RAW",
    requestBody: { values: [[w.name]] },
  });
  console.log(`Wrote "${w.name}" to Jobs!${w.col}1`);
}
console.log("Done.");
