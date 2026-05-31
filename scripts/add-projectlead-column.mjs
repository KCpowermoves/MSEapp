#!/usr/bin/env node
// One-time schema bump: add a "ProjectLead" header to column N of the
// Jobs tab so admin-created projects can name a lead tech. Existing
// rows leave col N blank, which the data layer treats as no lead set.
//
// Idempotent — re-running is safe.
//
// Usage: node scripts/add-projectlead-column.mjs

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

const res = await sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: "Jobs!A1:Z1",
});
const header = res.data.values?.[0] ?? [];
console.log(`Jobs header has ${header.length} columns: ${header.join(", ")}`);

if (header[13] === "ProjectLead") {
  console.log("Column N is already 'ProjectLead' — nothing to do.");
  process.exit(0);
}

if (header[13] && header[13] !== "ProjectLead") {
  console.error(
    `Column N is "${header[13]}" — refusing to overwrite. Fix manually.`
  );
  process.exit(1);
}

await sheets.spreadsheets.values.update({
  spreadsheetId: SHEET_ID,
  range: "Jobs!N1",
  valueInputOption: "RAW",
  requestBody: { values: [["ProjectLead"]] },
});
console.log('Wrote "ProjectLead" to Jobs!N1');
