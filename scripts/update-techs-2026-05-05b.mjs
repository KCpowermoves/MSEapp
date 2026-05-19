#!/usr/bin/env node
// Roster tweak — 2026-05-05 (second pass).
//   - Deactivate Jalen (Active=FALSE).
//   - Add last names: "Dante" -> "Dante Williams",
//     "Jamal" -> "Jamal Williams".
// Matches by exact current Name in column B.
//
// Run: node scripts/update-techs-2026-05-05b.mjs

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

const RENAMES = new Map([
  ["Dante", "Dante Williams"],
  ["Jamal", "Jamal Williams"],
]);
const DEACTIVATE = new Set(["Jalen"]);

const existing = await sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: "Techs!A2:F",
});
const rows = existing.data.values ?? [];

const summary = [];

for (let i = 0; i < rows.length; i++) {
  const name = String(rows[i][1] ?? "").trim();
  const sheetRow = i + 2;

  if (DEACTIVATE.has(name)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Techs!D${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [["FALSE"]] },
    });
    summary.push(`DEACTIVATED  ${rows[i][0] ?? "?"}  ${name}`);
    continue;
  }

  if (RENAMES.has(name)) {
    const newName = RENAMES.get(name);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Techs!B${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [[newName]] },
    });
    summary.push(`RENAMED      ${rows[i][0] ?? "?"}  ${name} -> ${newName}`);
  }
}

console.log("\n=== Roster tweak ===\n");
if (summary.length === 0) {
  console.log("  No matching rows found (already applied?).");
} else {
  for (const s of summary) console.log(`  ${s}`);
}
console.log("\nDone.\n");
