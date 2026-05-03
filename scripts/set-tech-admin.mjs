#!/usr/bin/env node
// Toggle a tech's admin flag in column F of the Techs tab.
// Run: node scripts/set-tech-admin.mjs "Tech Name" true|false

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
const [name, flag] = process.argv.slice(2);
if (!name || (flag !== "true" && flag !== "false")) {
  console.error('Usage: node scripts/set-tech-admin.mjs "Tech Name" true|false');
  process.exit(1);
}

const auth = new google.auth.JWT({
  email: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  key: required("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// Make sure column F has a header.
await sheets.spreadsheets.values.update({
  spreadsheetId: SHEET_ID,
  range: "Techs!F1",
  valueInputOption: "RAW",
  requestBody: { values: [["IsAdmin"]] },
});

const res = await sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: "Techs!A2:F",
});
const rows = res.data.values ?? [];
let row = -1;
for (let i = 0; i < rows.length; i++) {
  if (rows[i][1] === name) {
    row = i + 2;
    break;
  }
}
if (row < 0) {
  console.error(`No tech named "${name}" found.`);
  for (const r of rows) console.error(`  - ${r[1]}`);
  process.exit(1);
}

await sheets.spreadsheets.values.update({
  spreadsheetId: SHEET_ID,
  range: `Techs!F${row}`,
  valueInputOption: "RAW",
  requestBody: { values: [[flag === "true" ? "TRUE" : "FALSE"]] },
});

console.log(`Set ${name} (row ${row}) → IsAdmin = ${flag.toUpperCase()}`);
