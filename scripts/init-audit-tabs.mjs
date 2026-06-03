#!/usr/bin/env node
// Idempotent: creates the "Audits" and "Audit Items" tabs on the
// production Google Sheet if they don't already exist, and stamps
// the header rows. Safe to re-run. Does not touch any other tab.
//
// Usage:
//   node scripts/init-audit-tabs.mjs           # dry run
//   node scripts/init-audit-tabs.mjs --apply   # commit changes

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
    name: "Audits",
    headers: [
      "Audit ID",
      "Job ID",
      "Status",
      "Created At",
      "Created By",
      "Updated At",
      "Completed At",
      "Completed By",
      "Front Photo URL",
      "Fire Plan Photo URL",
      "BAS Photo URL",
      "BAS Notes",
      "Notes",
    ],
    validations: [{ col: "C", values: ["Draft", "Complete"] }],
  },
  {
    name: "Audit Items",
    headers: [
      "Item ID",
      "Audit ID",
      "Job ID",
      "Item Type",
      "Item Subtype",
      "Item Number",
      "Label",
      "Model Label Photo URL",
      "Nameplate Photo URL",
      "Fans Photo URL",
      "Temp Photo URL",
      "Wiring Photo URL",
      "Location Photo URL",
      "Schedule Photo URLs CSV",
      "Controls Photo URL",
      "Notes",
      "Logged By",
      "Logged At",
      "Status",
    ],
    validations: [
      { col: "D", values: ["Walk-In", "Thermostat", "Water-Source"] },
      { col: "S", values: ["Active", "Orphaned"] },
    ],
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
  console.log(
    apply
      ? "APPLY MODE — will create tabs + stamp headers"
      : "DRY RUN — pass --apply to commit changes"
  );
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
    // Apply dropdown validations via batchUpdate (DataValidation rule).
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
