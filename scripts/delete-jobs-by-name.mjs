#!/usr/bin/env node
// Soft-delete jobs from the Jobs sheet by exact customer name. Sets
// status=Closed so the row stays in the sheet for audit but stops
// appearing in the app's active job lists, customer rollup, and
// media library.
//
// Usage:
//   node scripts/delete-jobs-by-name.mjs           # dry run
//   node scripts/delete-jobs-by-name.mjs --apply   # commit changes

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
  console.error("Missing Google service-account env vars in .env.local");
  process.exit(1);
}

const apply = process.argv.includes("--apply");

// Test jobs Kevin flagged for cleanup. Updated 2026-05-31 with the
// three junk rows created during cover-photo QA.
const TARGET_NAMES = [
  "hsdhfshd",
  "34234234",
  "table store",
];
const targets = new Set(TARGET_NAMES.map((n) => n.trim().toLowerCase()));

const auth = new google.auth.JWT({
  email: SA_EMAIL,
  key: SA_KEY,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

async function main() {
  console.log(
    `\n${apply ? "APPLY MODE — will close matching rows" : "DRY RUN — no writes (pass --apply to close them)"}`
  );
  console.log(`Targeting ${TARGET_NAMES.length} exact customer names.\n`);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Jobs!A2:M",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = res.data.values ?? [];

  const matches = [];
  rows.forEach((row, i) => {
    const sheetRow = i + 2; // 1-indexed sheet row, +1 for header
    const jobId = String(row[0] ?? "");
    const customerName = String(row[3] ?? "").trim();
    const territory = String(row[5] ?? "");
    const status = String(row[6] ?? "");
    if (!jobId) return;
    if (status === "Closed") return; // already hidden
    if (targets.has(customerName.toLowerCase())) {
      matches.push({
        sheetRow,
        jobId,
        customerName,
        territory,
        status,
      });
    }
  });

  if (matches.length === 0) {
    console.log("No matching active jobs found. Nothing to do.\n");
    return;
  }

  console.log(`Found ${matches.length} active job(s) matching the list:\n`);
  for (const m of matches) {
    console.log(
      `  row ${m.sheetRow.toString().padStart(3, " ")}  ${m.jobId.padEnd(16)}  ${m.customerName.padEnd(30)} ${m.territory}`
    );
  }

  // Report names we expected but didn't find.
  const foundNames = new Set(
    matches.map((m) => m.customerName.toLowerCase())
  );
  const missing = TARGET_NAMES.filter(
    (n) => !foundNames.has(n.trim().toLowerCase())
  );
  if (missing.length > 0) {
    console.log(`\nNot found / already closed (${missing.length}):`);
    for (const n of missing) console.log(`  - ${n}`);
  }

  if (!apply) {
    console.log(`\nDry run complete. Re-run with --apply to close these jobs.\n`);
    return;
  }

  console.log(`\nClosing ${matches.length} job(s)...`);
  const data = matches.map((m) => ({
    range: `Jobs!G${m.sheetRow}`,
    values: [["Closed"]],
  }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      data,
      valueInputOption: "RAW",
    },
  });
  console.log(`Done.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
