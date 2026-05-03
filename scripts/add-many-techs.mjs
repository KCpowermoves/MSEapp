#!/usr/bin/env node
// Add a batch of techs at once. Sequential PINs starting from 2001.
// Marks admins via the F column. Idempotent — re-running with the same
// names updates rather than duplicates.
//
// Run: node scripts/add-many-techs.mjs

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

const NEW_TECHS = [
  { name: "Crystal Robinson", admin: true,  pin: "2001" },
  { name: "Jami Cuffley",     admin: true,  pin: "2002" },
  { name: "Catherine Burk",   admin: true,  pin: "2003" },
  { name: "Dante",            admin: false, pin: "2004" },
  { name: "Jalen",            admin: false, pin: "2005" },
  { name: "Jamal",            admin: false, pin: "2006" },
  { name: "Matt",             admin: false, pin: "2007" },
  { name: "Joe",              admin: false, pin: "2008" },
  { name: "Mike",             admin: false, pin: "2009" },
];

// Make sure the Techs header row covers column F.
await sheets.spreadsheets.values.update({
  spreadsheetId: SHEET_ID,
  range: "Techs!A1:F1",
  valueInputOption: "RAW",
  requestBody: {
    values: [["TechID", "Name", "PinHash", "Active", "Phone", "IsAdmin"]],
  },
});

const existing = await sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: "Techs!A2:F",
});
const rows = existing.data.values ?? [];
let nextNum = rows.length + 1;

const summary = [];

for (const t of NEW_TECHS) {
  const pinHash = await bcrypt.hash(t.pin, 10);
  const isAdminFlag = t.admin ? "TRUE" : "FALSE";

  // Update in place if a row with this name already exists.
  const matchIdx = rows.findIndex((r) => r[1] === t.name);
  if (matchIdx >= 0) {
    const sheetRow = matchIdx + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Techs!C${sheetRow}:F${sheetRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [[pinHash, "TRUE", "", isAdminFlag]] },
    });
    summary.push({ techId: rows[matchIdx][0] ?? `(row ${sheetRow})`, name: t.name, pin: t.pin, admin: t.admin, action: "updated" });
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
      values: [[techId, t.name, pinHash, "TRUE", "", isAdminFlag]],
    },
  });
  summary.push({ techId, name: t.name, pin: t.pin, admin: t.admin, action: "added" });
}

console.log("\n=== Tech credentials ===\n");
for (const s of summary) {
  const tag = s.admin ? "ADMIN" : "TECH ";
  console.log(
    `${tag} | ${s.techId} | ${s.name.padEnd(20)} | PIN: ${s.pin} | ${s.action}`
  );
}
console.log("\nDone.");
