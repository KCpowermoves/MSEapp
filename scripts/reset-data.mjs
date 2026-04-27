#!/usr/bin/env node
// Wipe all data rows from operational tabs (keeps headers + Pay Rates +
// Pay Calc formulas + Techs intact). Use after schema changes during
// early development.
//
// Run: node scripts/reset-data.mjs

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

const TABS_TO_WIPE = [
  "Jobs",
  "Dispatches",
  "Units Serviced",
  "Additional Services",
  "Pay Attribution",
];

async function clearTab(tab) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${tab}!A2:ZZ`,
  });
  console.log(`  cleared ${tab}`);
}

async function main() {
  console.log("Wiping data rows (keeping headers + Techs)...");
  for (const tab of TABS_TO_WIPE) {
    try {
      await clearTab(tab);
    } catch (e) {
      console.warn(`  skipped ${tab}: ${e.message}`);
    }
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
