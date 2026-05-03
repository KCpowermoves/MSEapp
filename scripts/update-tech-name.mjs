#!/usr/bin/env node
// Update a tech's display name in the Techs tab.
// Run: node scripts/update-tech-name.mjs "Old Name" "New Name"

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
const [oldName, newName] = process.argv.slice(2);
if (!oldName || !newName) {
  console.error('Usage: node scripts/update-tech-name.mjs "Old Name" "New Name"');
  process.exit(1);
}

const auth = new google.auth.JWT({
  email: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  key: required("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

const res = await sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: "Techs!A2:E",
});
const rows = res.data.values ?? [];

let foundAt = -1;
for (let i = 0; i < rows.length; i++) {
  if (rows[i][1] === oldName) {
    foundAt = i + 2; // 1-indexed row in sheet, +1 for header
    break;
  }
}
if (foundAt < 0) {
  console.error(`No tech named "${oldName}" found.`);
  console.error("Available techs:");
  for (const r of rows) console.error(`  - ${r[1]}`);
  process.exit(1);
}

await sheets.spreadsheets.values.update({
  spreadsheetId: SHEET_ID,
  range: `Techs!B${foundAt}`,
  valueInputOption: "RAW",
  requestBody: { values: [[newName]] },
});

console.log(`Updated row ${foundAt}: "${oldName}" → "${newName}"`);
