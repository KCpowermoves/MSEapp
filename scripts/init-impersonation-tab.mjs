#!/usr/bin/env node
// Idempotent: creates the "Impersonation Log" tab on the production
// sheet if it doesn't already exist. Safe to re-run.
//
// Usage:
//   node scripts/init-impersonation-tab.mjs           # dry run
//   node scripts/init-impersonation-tab.mjs --apply   # commit changes

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

const apply = process.argv.includes("--apply");

const TABS = [
  {
    name: "Impersonation Log",
    headers: [
      "Log ID",
      "Timestamp",
      "Event Type",
      "Admin Tech ID",
      "Admin Name",
      "Target Tech ID",
      "Target Name",
      "Notes",
    ],
    validations: [{ col: "C", values: ["Start", "Exit"] }],
  },
];

const auth = new google.auth.JWT({
  email: SA_EMAIL,
  key: SA_KEY,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

function colIndex(letter) {
  return letter.toUpperCase().charCodeAt(0) - "A".charCodeAt(0);
}

async function main() {
  console.log(apply ? "APPLY MODE" : "DRY RUN — pass --apply to commit");
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existing = new Set(meta.data.sheets.map((s) => s.properties.title));
  for (const tab of TABS) {
    if (existing.has(tab.name)) {
      console.log(`  [skip] "${tab.name}" already exists`);
      continue;
    }
    console.log(`  [plan] create "${tab.name}" with ${tab.headers.length} cols`);
    if (!apply) continue;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: tab.name,
                gridProperties: { frozenRowCount: 1 },
              },
            },
          },
        ],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${tab.name}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [tab.headers] },
    });
    const sheetMeta = (
      await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID })
    ).data.sheets.find((s) => s.properties.title === tab.name);
    const sheetId = sheetMeta.properties.sheetId;
    const validationRequests = tab.validations.map((v) => ({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: colIndex(v.col),
          endColumnIndex: colIndex(v.col) + 1,
        },
        rule: {
          condition: {
            type: "ONE_OF_LIST",
            values: v.values.map((value) => ({ userEnteredValue: value })),
          },
          showCustomUi: true,
          strict: true,
        },
      },
    }));
    if (validationRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { requests: validationRequests },
      });
    }
    console.log(`  [done] created "${tab.name}"`);
  }
  console.log(apply ? "\nDone." : "\nDry run complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
