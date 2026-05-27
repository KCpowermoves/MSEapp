#!/usr/bin/env node
// One-off: add the new "CrewEligible" column G to the Techs tab and
// flip it to FALSE for the three office admins (Crystal, Jami,
// Catherine) so they keep their admin login but stop appearing in
// the on-site crew picker. Everyone else stays unchanged — empty
// cell reads as TRUE (eligible) per the loader in lib/auth.ts.
//
// Run: node scripts/update-techs-crew-eligible.mjs

import { google } from "googleapis";
import { config } from "dotenv";

config({ path: ".env.local" });

const required = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing env var: ${k}`);
    process.exit(1);
  }
  return v;
};

const SHEET_ID = required("GOOGLE_SHEET_ID");
const auth = new google.auth.JWT({
  email: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  key: required("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

const NOT_ELIGIBLE = new Set(["Crystal R.", "Jami C.", "Catherine B."]);

// 1. Ensure column G has a header so the sheet view is readable.
await sheets.spreadsheets.values.update({
  spreadsheetId: SHEET_ID,
  range: "Techs!G1",
  valueInputOption: "RAW",
  requestBody: { values: [["CrewEligible"]] },
});

// 2. Walk the roster and flip G to FALSE for the named admins. Leave
//    everyone else's G cell untouched — empty defaults to TRUE in the
//    reader.
const existing = await sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: "Techs!A2:G",
});
const rows = existing.data.values ?? [];

const summary = [];
for (let i = 0; i < rows.length; i++) {
  const name = String(rows[i][1] ?? "").trim();
  if (!NOT_ELIGIBLE.has(name)) continue;
  const sheetRow = i + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Techs!G${sheetRow}`,
    valueInputOption: "RAW",
    requestBody: { values: [["FALSE"]] },
  });
  summary.push(`HID FROM CREW PICKER  ${rows[i][0] ?? "?"}  ${name}`);
}

console.log("\n=== Crew eligibility ===\n");
if (summary.length === 0) {
  console.log("  No matching rows found (already applied?).");
} else {
  for (const s of summary) console.log(`  ${s}`);
}
console.log("\nDone.\n");
