#!/usr/bin/env node
// One-shot verification — reads row 1 of the Dispatches tab and the
// most recent submitted dispatch row, then prints both side by side
// against what `rowToDispatch()` in lib/data/dispatches.ts expects.
//
// Use case: after manually setting headers in the sheet, confirm the
// sheet schema matches the code schema before relying on it.

import { google } from "googleapis";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "..", ".env.local") });

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });

// Expected column-by-column schema, mirroring rowToDispatch().
// "header" is what we expect in row 1 (display name in the sheet);
// "field" is the TS field name in the Dispatch type.
const SCHEMA = [
  { col: "A", header: "Dispatch ID",          field: "dispatchId" },
  { col: "B", header: "Job ID",               field: "jobId" },
  { col: "C", header: "Dispatch Date",        field: "dispatchDate" },
  { col: "D", header: "Techs On Site",        field: "techsOnSite" },
  { col: "E", header: "Crew Split",           field: "crewSplit" },
  { col: "F", header: "Driver",               field: "driver" },
  { col: "G", header: "Daily Driving Stipend", field: "dailyDrivingStipend" },
  { col: "H", header: "Travel Dispatch Bonus", field: "travelDispatchBonus" },
  { col: "I", header: "Photos Complete",      field: "photosComplete" },
  { col: "J", header: "Submitted At",         field: "submittedAt" },
  { col: "K", header: "signatureUrl",         field: "signatureUrl" },
  { col: "L", header: "signedByName",         field: "signedByName" },
  { col: "M", header: "reportPdfUrl",         field: "reportPdfUrl" },
  { col: "N", header: "customerEmail",        field: "customerEmail" },
  { col: "O", header: "customerRating",       field: "customerRating" },
  { col: "P", header: "customerFeedback",     field: "customerFeedback" },
  { col: "Q", header: "reportEmailedAt",      field: "reportEmailedAt" },
  { col: "R", header: "marketingConsent",     field: "marketingConsent" },
];

function fmt(v) {
  if (v === undefined || v === null || v === "") return "—";
  const s = String(v);
  return s.length > 60 ? s.slice(0, 57) + "..." : s;
}

async function main() {
  console.log("\nReading Dispatches!A1:R1 (headers)...");
  const head = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Dispatches!A1:R1",
  });
  const headers = head.data.values?.[0] ?? [];

  console.log("\nReading Dispatches!A2:R for the most recent submitted row...");
  const all = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Dispatches!A2:R",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = all.data.values ?? [];
  // Most-recent submitted row by submittedAt (col J / index 9).
  const submitted = rows.filter((r) => r[9]);
  submitted.sort((a, b) => String(b[9]).localeCompare(String(a[9])));
  const latest = submitted[0] ?? null;

  console.log("\nSchema check (sheet header vs code expected):\n");
  let mismatches = 0;
  for (let i = 0; i < SCHEMA.length; i++) {
    const expected = SCHEMA[i];
    const actual = headers[i] ?? "";
    const ok = actual === expected.header;
    if (!ok) mismatches++;
    console.log(
      `  ${expected.col}  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"}  ${expected.header.padEnd(22)}  ${ok ? "" : `(sheet has: "${actual}")`}`
    );
  }

  if (latest) {
    console.log(`\nLatest submitted dispatch (${latest[0]} — submitted ${latest[9]}):\n`);
    for (let i = 0; i < SCHEMA.length; i++) {
      const v = latest[i];
      console.log(
        `  ${SCHEMA[i].col}  ${SCHEMA[i].field.padEnd(22)} = ${fmt(v)}`
      );
    }
  } else {
    console.log("\nNo submitted dispatches found yet — header check above is enough.\n");
  }

  console.log(
    `\nResult: ${mismatches === 0 ? "\x1b[32mALL HEADERS MATCH\x1b[0m" : `\x1b[31m${mismatches} MISMATCH(ES) — fix headers in the sheet\x1b[0m`}\n`
  );
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Verification failed:", e.message ?? e);
  process.exit(1);
});
