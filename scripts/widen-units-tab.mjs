#!/usr/bin/env node
// Idempotent: ensures the "Units Serviced" tab is at least 27 columns
// wide so the hidden col AA (EngineeringSpecs JSON) can be written.
// Safe to re-run — only grows the grid, never shrinks or clears cells.
//
// Usage:
//   node scripts/widen-units-tab.mjs           # dry run
//   node scripts/widen-units-tab.mjs --apply   # commit changes

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
  console.error("Missing Google service-account env vars in .env.local");
  process.exit(1);
}

const TAB = "Units Serviced";
const MIN_COLS = 27; // through col AA

const apply = process.argv.includes("--apply");

const auth = new google.auth.JWT({
  email: SA_EMAIL,
  key: SA_KEY,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

async function main() {
  console.log(
    apply ? "APPLY MODE — will widen if needed" : "DRY RUN — pass --apply"
  );
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheet = meta.data.sheets.find((s) => s.properties.title === TAB);
  if (!sheet) {
    console.error(`Tab "${TAB}" not found`);
    process.exit(1);
  }
  const cols = sheet.properties.gridProperties.columnCount ?? 0;
  console.log(`  "${TAB}" currently ${cols} columns wide`);
  if (cols < MIN_COLS) {
    console.log(`  [plan] append ${MIN_COLS - cols} column(s) → ${MIN_COLS}`);
    if (apply) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [
            {
              appendDimension: {
                sheetId: sheet.properties.sheetId,
                dimension: "COLUMNS",
                length: MIN_COLS - cols,
              },
            },
          ],
        },
      });
      console.log(`  [done] widened "${TAB}" to ${MIN_COLS} columns`);
    }
  } else {
    console.log(`  [skip] already >= ${MIN_COLS} columns`);
  }

  // Stamp the AA header so the hidden JSON column is self-documenting.
  const header = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!AA1`,
  });
  const current = header.data.values?.[0]?.[0] ?? "";
  const wanted = "Engineering Specs (hidden)";
  if (current !== wanted) {
    console.log(`  [plan] stamp AA1 header → "${wanted}"`);
    if (apply) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${TAB}!AA1`,
        valueInputOption: "RAW",
        requestBody: { values: [[wanted]] },
      });
      console.log(`  [done] stamped AA1 header`);
    }
  } else {
    console.log(`  [skip] AA1 header already set`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
