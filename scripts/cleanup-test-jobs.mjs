#!/usr/bin/env node
// Cleanup script — finds rows in the Jobs tab that look like e2e or
// manual test data and (optionally) marks them Closed so they drop out
// of the Active jobs list. Soft-delete by design: the rows stay in the
// sheet for audit, just hidden from the app view.
//
// Usage:
//   node scripts/cleanup-test-jobs.mjs           # dry-run, lists matches
//   node scripts/cleanup-test-jobs.mjs --apply   # actually close them
//
// Match heuristics (case-insensitive):
//   - customer name contains "test"
//   - customer name matches one of the legacy hardcoded e2e names
//     ("BGE Solo Test", "Delmarva Self-Sold", "PEPCO Tri-Crew")
//   - customer name starts with "e2e"

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

const auth = new google.auth.JWT({
  email: SA_EMAIL,
  key: SA_KEY,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

const LEGACY_E2E_NAMES = new Set([
  "BGE Solo Test",
  "Delmarva Self-Sold",
  "PEPCO Tri-Crew",
]);

function looksLikeTest(customerName) {
  if (!customerName) return false;
  const trimmed = customerName.trim();
  if (LEGACY_E2E_NAMES.has(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("e2e")) return true;
  if (lower.includes("test")) return true;
  return false;
}

async function main() {
  console.log(
    `\n${apply ? "APPLY MODE — will close matching rows" : "DRY RUN — no writes (pass --apply to close them)"}`
  );

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
    const customerName = String(row[3] ?? "");
    const territory = String(row[5] ?? "");
    const status = String(row[6] ?? "");
    const selfSold = String(row[7] ?? "");
    if (!jobId) return;
    if (status === "Closed") return; // already hidden
    if (looksLikeTest(customerName)) {
      matches.push({
        sheetRow,
        jobId,
        customerName,
        territory,
        selfSold: selfSold === "TRUE",
      });
    }
  });

  if (matches.length === 0) {
    console.log("\nNo test-looking jobs found that are still Active. Nothing to do.\n");
    return;
  }

  console.log(`\nFound ${matches.length} test-looking active job(s):\n`);
  for (const m of matches) {
    console.log(
      `  row ${m.sheetRow.toString().padStart(3, " ")}  ${m.jobId.padEnd(14)}  ${m.customerName.padEnd(30)} ${m.territory}${m.selfSold ? "  · self-sold" : ""}`
    );
  }

  if (!apply) {
    console.log(`\nDry run complete. Re-run with --apply to close these jobs.\n`);
    return;
  }

  console.log(`\nClosing ${matches.length} job(s)...\n`);
  // Use batchUpdate to set status=Closed in column G for each row.
  const data = matches.map((m) => ({
    range: `Jobs!G${m.sheetRow}`,
    values: [["Closed"]],
  }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data,
    },
  });
  console.log(`Done — ${matches.length} test jobs closed (still in the sheet for audit).\n`);
}

main().catch((e) => {
  console.error("Cleanup failed:", e.message ?? e);
  process.exit(1);
});
