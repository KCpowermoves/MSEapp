#!/usr/bin/env node
// Idempotent — creates the "Location Events" tab and header row if missing.
// Safe to run multiple times.
//
// Run: node scripts/init-location-tab.mjs

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
const TAB = "Location Events";
const HEADERS = [
  "EventID",
  "Timestamp",
  "TechName",
  "EventType",
  "Lat",
  "Lng",
  "Accuracy (m)",
  "JobID",
  "UnitID",
  "Notes",
];

const auth = new google.auth.JWT({
  email: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  key: required("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
const exists = (meta.data.sheets ?? []).some(
  (s) => s.properties?.title === TAB
);

if (!exists) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title: TAB } } }],
    },
  });
  console.log(`Created tab "${TAB}".`);
} else {
  console.log(`Tab "${TAB}" already exists.`);
}

// Always ensure the header row matches.
await sheets.spreadsheets.values.update({
  spreadsheetId: SHEET_ID,
  range: `${TAB}!A1`,
  valueInputOption: "RAW",
  requestBody: { values: [HEADERS] },
});
console.log(`Header row set on "${TAB}".`);
console.log("Done.");
