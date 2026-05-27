#!/usr/bin/env node
// Roster tweak — 2026-05-27.
//   - Rename every active tech from "First Last" to "First L." in
//     column B. Match by exact current Name.
//   - Add Ivan P with PIN 0007 if missing (idempotent).
//
// Run: node scripts/update-techs-2026-05-27.mjs

import { google } from "googleapis";
import bcrypt from "bcryptjs";
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

const RENAMES = new Map([
  ["Kevin Cheung",     "Kevin C."],
  ["Crystal Robinson", "Crystal R."],
  ["Jami Cuffley",     "Jami C."],
  ["Catherine Burk",   "Catherine B."],
  ["Dante Williams",   "Dante W."],
  ["Jamal Williams",   "Jamal W."],
  ["Matt Ventura",     "Matt V."],
  ["Mike Rippeon",     "Mike R."],
  ["Joe Witczak",      "Joe W."],
  ["Melvin Tuggle",    "Melvin T."],
  ["Ronald Tribull",   "Ronald T."],
  ["Oliver Holmes",    "Oliver H."],
]);

const NEW_TECHS = [
  { name: "Ivan P", pin: "0007" },
];

const existing = await sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: "Techs!A2:F",
});
const rows = existing.data.values ?? [];

const summary = [];
const renamedRows = new Set();

// 1. Renames — case-sensitive exact match on column B.
for (let i = 0; i < rows.length; i++) {
  const name = String(rows[i][1] ?? "").trim();
  const sheetRow = i + 2;
  if (RENAMES.has(name)) {
    const next = RENAMES.get(name);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Techs!B${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [[next]] },
    });
    summary.push(`RENAMED      ${rows[i][0] ?? "?"}  ${name} -> ${next}`);
    renamedRows.add(sheetRow);
  }
}

// 2. Add new techs. If a row with the new name (e.g. "Ivan P") or its
//    short form already exists, update in place rather than duplicate.
let nextNum = rows.length + 1;
for (const t of NEW_TECHS) {
  const pinHash = await bcrypt.hash(t.pin, 10);
  const matchIdx = rows.findIndex((r) => r[1] === t.name);
  if (matchIdx >= 0) {
    const sheetRow = matchIdx + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Techs!C${sheetRow}:F${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [[pinHash, "TRUE", "", "FALSE"]] },
    });
    summary.push(
      `UPDATED      ${rows[matchIdx][0] ?? "?"}  ${t.name}  PIN: ${t.pin}`
    );
    continue;
  }
  const techId = `TECH-${String(nextNum).padStart(3, "0")}`;
  nextNum++;
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Techs!A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[techId, t.name, pinHash, "TRUE", "", "FALSE"]],
    },
  });
  summary.push(`ADDED        ${techId}  ${t.name.padEnd(14)}  PIN: ${t.pin}`);
}

console.log("\n=== Roster tweak ===\n");
if (summary.length === 0) {
  console.log("  No matching rows found (already applied?).");
} else {
  for (const s of summary) console.log(`  ${s}`);
}
console.log("\nDone.\n");
