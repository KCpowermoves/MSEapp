#!/usr/bin/env node
// Idempotent — creates the "Payroll Periods" + "Payroll Adjustments" tabs
// with their header rows if missing. Safe to run multiple times.
//
// Run: node scripts/init-payroll-tabs.mjs

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

const TABS = [
  {
    name: "Payroll Periods",
    headers: [
      "PeriodId",
      "StartDate",
      "EndDate",
      "Status",
      "Label",
      "CreatedBy",
      "CreatedAt",
      "ApprovedBy",
      "ApprovedAt",
      "PaidBy",
      "PaidAt",
      "Note",
    ],
  },
  {
    name: "Payroll Adjustments",
    headers: [
      "AdjustmentId",
      "PeriodId",
      "TechName",
      "Type",
      "Amount",
      "Description",
      "RelatedDispatchId",
      "RelatedUnitId",
      "RelatedTech",
      "CreatedBy",
      "CreatedAt",
      "Note",
    ],
  },
];

const auth = new google.auth.JWT({
  email: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  key: required("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
const existingTabs = new Set(
  (meta.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter(Boolean)
);

for (const tab of TABS) {
  if (!existingTabs.has(tab.name)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tab.name } } }],
      },
    });
    console.log(`Created tab "${tab.name}".`);
  } else {
    console.log(`Tab "${tab.name}" already exists.`);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tab.name}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [tab.headers] },
  });
  console.log(`Header row set on "${tab.name}".`);
}

console.log("\nPayroll tabs ready. Run /admin/payroll to start using them.");
