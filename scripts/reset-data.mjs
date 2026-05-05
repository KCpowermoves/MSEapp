#!/usr/bin/env node
// Wipe all operational data rows. Headers, Techs, Pay Rates, and Pay
// Calc formulas stay intact. Use before going live to clear out test
// data.
//
// Defaults to dry-run — pass --apply to actually clear.
//
// Run:
//   node scripts/reset-data.mjs            # show counts, no writes
//   node scripts/reset-data.mjs --apply    # clear everything

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
const apply = process.argv.includes("--apply");

const auth = new google.auth.JWT({
  email: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  key: required("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// Operational tabs that accumulate per-job data. Headers in row 1 stay.
const TABS_TO_WIPE = [
  "Jobs",
  "Dispatches",
  "Units Serviced",
  "Additional Services",
  "Pay Attribution",
  "Location Events",
];

async function rowCount(tab) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${tab}!A2:A`,
    });
    return (res.data.values ?? []).filter((r) => r[0]).length;
  } catch (e) {
    return null;
  }
}

async function clearTab(tab) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${tab}!A2:ZZ`,
  });
}

async function main() {
  console.log(
    `\n${apply ? "APPLY MODE — clearing data rows" : "DRY RUN — pass --apply to clear (no writes happening now)"}\n`
  );

  const counts = [];
  for (const tab of TABS_TO_WIPE) {
    const n = await rowCount(tab);
    counts.push({ tab, rows: n });
  }

  for (const c of counts) {
    if (c.rows === null) {
      console.log(`  ${c.tab.padEnd(22)}  not found / unreadable`);
    } else {
      console.log(`  ${c.tab.padEnd(22)}  ${c.rows} row(s)`);
    }
  }

  const total = counts.reduce((sum, c) => sum + (c.rows ?? 0), 0);
  console.log(`\nTotal data rows: ${total}\n`);

  if (!apply) {
    console.log("Re-run with --apply to clear.\n");
    console.log("After clearing, you'll also want to:");
    console.log("  - reinstall the PWA on any devices that have offline drafts");
    console.log("  - move/clean Drive folders for old jobs (manual)\n");
    return;
  }

  for (const tab of TABS_TO_WIPE) {
    try {
      await clearTab(tab);
      console.log(`  cleared ${tab}`);
    } catch (e) {
      console.warn(`  failed ${tab}: ${e.message}`);
    }
  }
  console.log("\nDone — operational tabs are now empty (headers preserved).");
  console.log("Techs, Pay Rates, and Pay Calc untouched.\n");
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
