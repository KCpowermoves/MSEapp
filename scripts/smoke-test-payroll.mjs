#!/usr/bin/env node
// Smoke test: verifies the Payroll Periods + Payroll Adjustments tabs
// are provisioned correctly and that a round-trip write+read works.
// Cleans up the test rows on success.

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

const EXPECTED_PERIOD_HEADERS = [
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
];

const EXPECTED_ADJUSTMENT_HEADERS = [
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
];

let pass = 0;
let fail = 0;

function check(label, fn) {
  try {
    const result = fn();
    if (result === false) {
      console.log(`  ✗ ${label}`);
      fail++;
    } else {
      console.log(`  ✓ ${label}`);
      pass++;
    }
  } catch (e) {
    console.log(`  ✗ ${label} — ${e.message}`);
    fail++;
  }
}

async function readHeaders(tab) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${tab}!A1:Z1`,
  });
  return (res.data.values?.[0] ?? []).filter(Boolean);
}

async function readAll(tab) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${tab}!A2:ZZ`,
  });
  return res.data.values ?? [];
}

console.log("\nPayroll smoke test\n");

console.log("Tabs exist & headers match:");
const periodHeaders = await readHeaders("Payroll Periods");
check(
  `Payroll Periods headers: ${EXPECTED_PERIOD_HEADERS.length} columns`,
  () =>
    EXPECTED_PERIOD_HEADERS.every(
      (h, i) => periodHeaders[i] === h
    )
);
const adjHeaders = await readHeaders("Payroll Adjustments");
check(
  `Payroll Adjustments headers: ${EXPECTED_ADJUSTMENT_HEADERS.length} columns`,
  () =>
    EXPECTED_ADJUSTMENT_HEADERS.every(
      (h, i) => adjHeaders[i] === h
    )
);

// Round-trip: write a Draft period, list it, then delete it.
console.log("\nRound-trip a draft period:");
const testId = `SMOKE-${Date.now()}`;
const testStart = "2026-01-01";
const testEnd = "2026-01-07";
const createdAt = new Date().toISOString();
await sheets.spreadsheets.values.append({
  spreadsheetId: SHEET_ID,
  range: "Payroll Periods!A1",
  valueInputOption: "USER_ENTERED",
  insertDataOption: "INSERT_ROWS",
  requestBody: {
    values: [
      [
        testId,
        testStart,
        testEnd,
        "Draft",
        "Smoke test period — safe to delete",
        "smoke-test",
        createdAt,
        "",
        "",
        "",
        "",
        "smoke",
      ],
    ],
  },
});
console.log(`  ✓ Appended test period ${testId}`);

const rows = await readAll("Payroll Periods");
const found = rows.find((r) => r[0] === testId);
check("Test period readable via A2:ZZ", () => Boolean(found));
check("Status column = 'Draft'", () => found?.[3] === "Draft");
check(
  "Label column carries our text",
  () => String(found?.[4] ?? "").includes("Smoke test")
);

// Cleanup — clear the row's values in place. Sheet keeps the row
// but the data layer's `.filter(r => r[0])` will exclude it.
console.log("\nCleaning up:");
const rowIdx = rows.findIndex((r) => r[0] === testId) + 2; // +2: header + 1-indexed
await sheets.spreadsheets.values.update({
  spreadsheetId: SHEET_ID,
  range: `Payroll Periods!A${rowIdx}:L${rowIdx}`,
  valueInputOption: "RAW",
  requestBody: {
    values: [["", "", "", "", "", "", "", "", "", "", "", ""]],
  },
});
console.log(`  ✓ Cleared test row ${rowIdx}`);

console.log(`\nResults: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
